import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import { errorMessage } from '../../onboarding/onboarding.types';

// 算定基礎届・賞与支払届（一括型の届出）の訂正届・取消届。提出済みの届出から人を選んで作り、訂正届は行を直す。
// 承認・提出は一括型の画面のいつもの操作（承認の依頼・承認・提出の部品）で行う。

export type RunSource = 'santei' | 'bonus';
export type RunCorrectionKind = 'correction' | 'cancellation';
type Person = Record<string, any>;

export interface RunCorrectionInfo {
  kind: RunCorrectionKind | null;
  originalFilingId: string | null;
  originalNumber: number | null;
  reason: string | null;
  correctionCount: number;
  correctedByFilingIds: string[];
  cancelledByFilingIds: string[];
  cancelledEmployeeIds: string[];
}

/** 一括型の画面の届出の一覧の1件（santei.types・bonus.types の FilingSummary の共通部分） */
export interface RunFilingLike {
  id: string;
  number: number;
  status: string;
  personCount: number;
  mockStatus: string | null;
  submission: { method: 'mock' | 'paper'; date: string; acceptanceNumber: string | null } | null;
  filingType?: string;
  version: number;
  correction?: RunCorrectionInfo;
}

export interface RunCorrectionRow { employeeId: string; field: string; before: string; after: string }

/** run を表す引数（算定基礎届は年、賞与は支給月） */
export type RunArgs = { officeId: string; year: number } | { officeId: string; payMonth: string };

export const KIND_LABEL: Record<RunCorrectionKind, string> = { correction: '訂正届', cancellation: '取消届' };

/** 届出の見出し（「3件目：1件目の訂正届」） */
export function runFilingTitle(f: RunFilingLike, baseLabel: string): string {
  const c = f.correction;
  if (c?.kind) return `${f.number}件目：${c.originalNumber ?? '?'}件目の${baseLabel}の${KIND_LABEL[c.kind]}`;
  return `${f.number}件目の${baseLabel}`;
}

/** 提出し終えたか（模擬電子申請の完了か、紙の提出） */
export const isSubmittedRun = (f: RunFilingLike) => f.status === 'submitted' || f.mockStatus === 'completed';

/** 画面で直す項目（サーバーの filings/run-correction/rules.ts の flattenPerson と同じ） */
export function flatFields(source: RunSource, p: Person): { key: string; value: string | number | null; text: boolean }[] {
  const rows: { key: string; value: string | number | null; text: boolean }[] = [];
  const add = (key: string, value: unknown) => rows.push({ key, value: (value ?? null) as string | number | null, text: TEXT_FIELDS.has(key) });
  if (source === 'santei') {
    for (const k of ['被保険者整理番号', '被保険者氏名', '生年月日', '従前の標準報酬月額_健康保険', '従前の標準報酬月額_厚生年金', '従前の改定月']) add(k, p[k]);
    for (const m of (p['months'] ?? []) as Person[]) {
      add(`${m['月']}月_支払基礎日数`, m['支払基礎日数']); add(`${m['月']}月_通貨`, m['通貨']); add(`${m['月']}月_現物`, m['現物']);
    }
    for (const k of ['総計', '平均額', '修正平均額', '決定_健康保険等級', '決定_健康保険標準報酬月額', '決定_厚生年金等級', '決定_厚生年金標準報酬月額', '備考その他']) add(k, p[k]);
  } else {
    for (const k of ['被保険者整理番号', '被保険者氏名', '生年月日', '賞与支払年月日', '賞与額_通貨', '賞与額_現物']) add(k, p[k]);
  }
  return rows;
}
const TEXT_FIELDS = new Set(['被保険者整理番号', '被保険者氏名', '生年月日', '従前の改定月', '備考その他', '賞与支払年月日']);

interface RunDetail {
  id: string; version: number; status: string; header: Record<string, unknown>; persons: Person[];
  originalPersons: Person[] | null; corrections: RunCorrectionRow[]; correction: RunCorrectionInfo;
}

function caller(functions: Functions, auth: AuthService, source: RunSource, parentId: string, run: RunArgs) {
  return {
    detail: async (filingId: string) =>
      (await httpsCallable<object, RunDetail>(functions, source === 'santei' ? 'santeiFilingGet' : 'bonusFilingGet')({ companyId: auth.companyId, ...run, filingId })).data,
    create: async (filingId: string, kind: RunCorrectionKind, employeeIds: string[], reason: string) =>
      (await httpsCallable<object, { filingId: string }>(functions, 'runCorrectionCreate')({ companyId: auth.companyId, source, parentId, filingId, kind, employeeIds, reason })).data,
    update: async (filingId: string, expectedVersion: number, persons: Record<string, Record<string, string | null>> | undefined, reason: string) =>
      (await httpsCallable<object, { corrections: RunCorrectionRow[] }>(functions, 'runCorrectionUpdate')({
        companyId: auth.companyId, source, parentId, filingId, expectedVersion, action: 'save', persons, reason,
      })).data,
  };
}

/**
 * 届出のカードの中に置く。提出済みの届出には「訂正届・取消届を作る」、訂正届・取消届には元の届出・理由・訂正箇所と「直す」を出す
 */
@Component({
  selector: 'app-run-correction',
  standalone: true,
  imports: [MatButtonModule, MatIconModule],
  template: `
    @let f = filing();
    @let c = f.correction;
    @if (c?.kind) {
      <p class="info">
        {{ c!.originalNumber }}件目の届出（提出済み）の{{ kindLabel[c!.kind!] }}です。理由：{{ c!.reason || '（未記入）' }}
        @if (c!.kind === 'correction') {・訂正箇所 {{ c!.correctionCount }}件 }
      </p>
      @if (f.status === 'draft') {
        <button mat-stroked-button type="button" (click)="edit()" [disabled]="working()">
          <mat-icon>edit</mat-icon>{{ c!.kind === 'correction' ? '訂正の内容を直す' : '理由を直す' }}
        </button>
      }
      @if (f.status === 'draft' && c!.kind === 'correction' && !c!.correctionCount) {
        <p class="warn">まだ直した項目がありません。「訂正の内容を直す」で訂正後の値を入れてから承認を依頼します。</p>
      }
    } @else if (canCorrect()) {
      @if (c?.correctedByFilingIds?.length || c?.cancelledEmployeeIds?.length) {
        <p class="info">
          @if (c!.correctedByFilingIds.length) { 訂正届を{{ c!.correctedByFilingIds.length }}件提出済み。 }
          @if (c!.cancelledEmployeeIds.length) { 取消届で{{ c!.cancelledEmployeeIds.length }}名を取り消し済み。 }
        </p>
      }
      <details class="after">
        <summary>提出したあとに誤りが見つかったら</summary>
        <p class="muted">誤りのある人を選んで、その人の行だけの訂正届（直した値と訂正箇所の一覧）か取消届を作ります。等級・保険料は自動では直りません。訂正届を出したら、従業員の画面の「等級を遡って直す」で直します。</p>
        <button mat-stroked-button type="button" (click)="create('correction')" [disabled]="working()">訂正届を作る</button>
        <button mat-button type="button" (click)="create('cancellation')" [disabled]="working()">取消届を作る</button>
      </details>
    }
  `,
  styles: [`
    :host { display: block; margin-top: 8px; }
    .info { margin: 4px 0; line-height: 1.7; }
    .warn { color: var(--app-color-warning, #b45309); margin: 4px 0; }
    .muted { color: var(--app-color-text-sub); line-height: 1.7; }
    .after summary { cursor: pointer; color: var(--app-color-text-sub); }
    .after button { margin-right: 8px; }
  `],
})
export class RunCorrectionComponent {
  source = input.required<RunSource>();
  parentId = input.required<string>();
  officeId = input.required<string>();
  /** 算定基礎届は年、賞与は支給月 */
  period = input.required<number | string>();
  filing = input.required<RunFilingLike>();
  changed = output<void>();
  kindLabel = KIND_LABEL;

  private functions = inject(Functions);
  private auth = inject(AuthService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  working = signal(false);

  canCorrect = computed(() => {
    const f = this.filing();
    return f.filingType !== 'bonusNonPayment' && isSubmittedRun(f) && this.auth.hasAnyRole('admin', 'operator');
  });

  private api() {
    const run: RunArgs = this.source() === 'santei' ? { officeId: this.officeId(), year: Number(this.period()) } : { officeId: this.officeId(), payMonth: String(this.period()) };
    return caller(this.functions, this.auth, this.source(), this.parentId(), run);
  }

  async create(kind: RunCorrectionKind) {
    this.working.set(true);
    try {
      const detail = await this.api().detail(this.filing().id);
      const result = await firstValueFrom(this.dialog.open(RunCorrectionCreateDialogComponent, {
        width: '640px', maxWidth: '96vw',
        data: { kind, number: this.filing().number, persons: detail.persons, cancelled: detail.correction?.cancelledEmployeeIds ?? [] },
      }).afterClosed()) as { employeeIds: string[]; reason: string } | undefined;
      if (!result) return;
      const { filingId } = await this.api().create(this.filing().id, kind, result.employeeIds, result.reason);
      this.snackBar.open(`${result.employeeIds.length}名の${KIND_LABEL[kind]}を作りました${kind === 'correction' ? '。訂正後の値を入れてください' : '。内容を確かめて承認を依頼してください'}`, '閉じる', { duration: 6000 });
      // 一覧の読み込み直しは1回にする（作った直後と保存の後で2回読むと、遅い方の古い結果が残ることがある）
      if (kind === 'correction') await this.openEditor(filingId, true);
      else this.changed.emit();
    } catch (e) {
      this.snackBar.open(errorMessage(e, `${KIND_LABEL[kind]}を作れませんでした`), '閉じる', { duration: 8000 });
    } finally {
      this.working.set(false);
    }
  }

  async edit() {
    this.working.set(true);
    try { await this.openEditor(this.filing().id); }
    catch (e) { this.snackBar.open(errorMessage(e, '届出を読み込めませんでした'), '閉じる', { duration: 6000 }); }
    finally { this.working.set(false); }
  }

  private async openEditor(filingId: string, created = false) {
    const detail = await this.api().detail(filingId);
    const saved = await firstValueFrom(this.dialog.open(RunCorrectionEditDialogComponent, {
      width: '900px', maxWidth: '96vw',
      data: { source: this.source(), detail, save: (persons: Record<string, Record<string, string | null>> | undefined, reason: string) => this.api().update(filingId, detail.version, persons, reason) },
    }).afterClosed());
    if (saved || created) this.changed.emit();
  }
}

/** 訂正届・取消届に載せる人と理由を選ぶ */
@Component({
  selector: 'app-run-correction-create-dialog',
  standalone: true,
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatInputModule],
  template: `
    <h2 mat-dialog-title>{{ data.number }}件目の届出から{{ label }}を作る</h2>
    <mat-dialog-content>
      <p class="muted">{{ data.kind === 'correction' ? '誤りのある人を選びます。次の画面で訂正後の値を入れます。' : '取り消す人（届出に載せるべきでなかった人など）を選びます。' }}</p>
      <mat-form-field appearance="outline" class="full">
        <mat-label>氏名・整理番号で絞り込む</mat-label>
        <input matInput [(ngModel)]="query" name="query">
      </mat-form-field>
      <div class="list" role="group" aria-label="対象の人">
        @for (p of shown(); track p['employeeId']) {
          <mat-checkbox [checked]="selected().has(p['employeeId'])" [disabled]="cancelled.has(p['employeeId'])" (change)="toggle(p['employeeId'])">
            {{ p['被保険者氏名'] }}<span class="muted">（整理番号 {{ p['被保険者整理番号'] || '未登録' }}）</span>
            @if (cancelled.has(p['employeeId'])) { <span class="muted">取消届を提出済み</span> }
          </mat-checkbox>
        } @empty { <p class="muted">該当する人がいません。</p> }
      </div>
      <p>選んだ人：{{ selected().size }}名</p>
      <mat-form-field appearance="outline" class="full">
        <mat-label>{{ data.kind === 'correction' ? '訂正の理由' : '取消の理由' }}</mat-label>
        <textarea matInput [(ngModel)]="reason" name="reason" rows="2" maxlength="500" required></textarea>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">やめる</button>
      <button mat-flat-button type="button" [disabled]="!selected().size || !reason.trim()" (click)="done()">{{ label }}を作る</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .full { width: 100%; }
    .muted { color: var(--app-color-text-sub); margin-left: 4px; }
    .list { display: flex; flex-direction: column; max-height: 40vh; overflow: auto; border: 1px solid var(--app-color-border); border-radius: 6px; padding: 4px 8px; }
  `],
})
export class RunCorrectionCreateDialogComponent {
  data = inject<{ kind: RunCorrectionKind; number: number; persons: Person[]; cancelled: string[] }>(MAT_DIALOG_DATA);
  private ref = inject(MatDialogRef<RunCorrectionCreateDialogComponent>);
  label = KIND_LABEL[this.data.kind];
  cancelled = new Set(this.data.cancelled);
  query = '';
  reason = '';
  selected = signal(new Set<string>());
  shown() {
    const q = this.query.replace(/\s/g, '');
    return q ? this.data.persons.filter(p => `${p['被保険者氏名']}${p['被保険者整理番号']}`.replace(/\s/g, '').includes(q)) : this.data.persons;
  }
  toggle(id: string) {
    const next = new Set(this.selected());
    if (next.has(id)) next.delete(id); else next.add(id);
    this.selected.set(next);
  }
  done() { this.ref.close({ employeeIds: [...this.selected()], reason: this.reason.trim() }); }
}

/** 訂正届の行（訂正後の値）と理由を直す。取消届は理由だけ */
@Component({
  selector: 'app-run-correction-edit-dialog',
  standalone: true,
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  template: `
    <h2 mat-dialog-title>{{ kind === 'correction' ? '訂正の内容を直す' : '取消の理由を直す' }}</h2>
    <mat-dialog-content>
      <mat-form-field appearance="outline" class="full">
        <mat-label>{{ kind === 'correction' ? '訂正の理由' : '取消の理由' }}</mat-label>
        <textarea matInput [(ngModel)]="reason" name="reason" rows="2" maxlength="500" required></textarea>
      </mat-form-field>
      @if (kind === 'correction') {
        <p class="muted">直す欄だけ書き換えます。合計（通貨＋現物）{{ data.source === 'bonus' ? 'と標準賞与額（千円未満切り捨て）' : '' }}は計算し直します。平均額・決定の等級は自動では変わらないので、必要なら書き換えます。</p>
        @for (p of persons; track p.id) {
          <h3>{{ p.name }}</h3>
          <table>
            <thead><tr><th>項目</th><th>元の届出</th><th>訂正後</th></tr></thead>
            <tbody>
              @for (r of p.rows; track r.key) {
                <tr [class.changed]="r.value !== r.original">
                  <td>{{ r.key }}</td>
                  <td class="num">{{ r.original || '（空欄）' }}</td>
                  <td><input class="cell" [attr.aria-label]="p.name + ' ' + r.key" [(ngModel)]="r.value" [name]="p.id + r.key" [attr.inputmode]="r.text ? null : 'numeric'"></td>
                </tr>
              }
            </tbody>
          </table>
        }
      }
      @if (error()) { <p class="bad" role="alert">{{ error() }}</p> }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">やめる</button>
      <button mat-flat-button type="button" [disabled]="saving() || !reason.trim()" (click)="save()">保存する</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .full { width: 100%; }
    .muted { color: var(--app-color-text-sub); line-height: 1.7; }
    .bad { color: var(--app-color-error, #b91c1c); }
    h3 { margin: 16px 0 4px; font-size: 14px; }
    table { border-collapse: collapse; width: 100%; font-size: 13px; }
    th, td { padding: 3px 6px; border-bottom: 1px solid var(--app-color-border); text-align: left; }
    th { background: var(--app-color-surface-sub); }
    .num { white-space: nowrap; }
    tr.changed td { background: color-mix(in srgb, var(--app-color-warning, #f59e0b) 12%, transparent); }
    .cell { width: 100%; box-sizing: border-box; font: inherit; padding: 3px 6px; border: 1px solid var(--app-color-border); border-radius: 4px; background: var(--app-color-surface, #fff); color: inherit; }
  `],
})
export class RunCorrectionEditDialogComponent {
  data = inject<{
    source: RunSource; detail: RunDetail;
    save: (persons: Record<string, Record<string, string | null>> | undefined, reason: string) => Promise<{ corrections: RunCorrectionRow[] }>;
  }>(MAT_DIALOG_DATA);
  private ref = inject(MatDialogRef<RunCorrectionEditDialogComponent>);
  private snackBar = inject(MatSnackBar);
  kind = this.data.detail.correction.kind!;
  reason = this.data.detail.correction.reason ?? '';
  saving = signal(false);
  error = signal('');
  private show = (v: unknown) => (v === null || v === undefined ? '' : String(v));
  persons = this.data.detail.persons.map(p => {
    const original = (this.data.detail.originalPersons ?? []).find(o => o['employeeId'] === p['employeeId']) ?? p;
    const before = new Map(flatFields(this.data.source, original).map(r => [r.key, this.show(r.value)]));
    return {
      id: p['employeeId'] as string, name: p['被保険者氏名'] as string,
      rows: flatFields(this.data.source, p).map(r => ({ key: r.key, text: r.text, original: before.get(r.key) ?? '', current: this.show(r.value), value: this.show(r.value) })),
    };
  });

  async save() {
    const patch: Record<string, Record<string, string | null>> = {};
    for (const p of this.persons) {
      for (const r of p.rows) {
        if (r.value === r.current) continue;
        (patch[p.id] ??= {})[r.key] = r.value.trim() === '' ? null : r.value.trim();
      }
    }
    this.saving.set(true);
    this.error.set('');
    try {
      const { corrections } = await this.data.save(this.kind === 'correction' && Object.keys(patch).length ? patch : undefined, this.reason.trim());
      this.snackBar.open(this.kind === 'correction' ? `保存しました（訂正箇所 ${corrections.length}件）` : '保存しました', '閉じる', { duration: 5000 });
      this.ref.close(true);
    } catch (e) {
      this.error.set(errorMessage(e, '保存できませんでした'));
    } finally {
      this.saving.set(false);
    }
  }
}
