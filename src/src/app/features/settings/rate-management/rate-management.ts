import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../../core/services/auth.service';
import { ConfirmService } from '../../../shared/confirm-dialog/confirm-dialog';

import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
interface PreviewItem { line: number; typeLabel: string; prefectureCode: string; insurerId: string; appliedFrom: string; totalRate: number; employeeRate: number; employerRate: number; current: { totalRate: number; appliedFrom: string } | null; change: number | null; duplicate: boolean }
interface ImpactRow { officeId: string; officeName: string; kind: 'monthly' | 'bonus'; yearMonth: string; unconfirmed: number; pending: number; confirmed: number }
interface HistoryItem { typeLabel: string; prefectureCode: string; insurerId: string; appliedFrom: string; appliedUntil: string | null; totalRate: number; employeeRate: number; employerRate: number; note: string }

const SAMPLE = '保険の種類,都道府県コード,保険者ID,適用開始年月,料率(‰),本人負担(‰),会社負担(‰),備考\n健康保険,13,,2027-03,99.1,,,東京都\n介護保険,,,2027-03,15.9,,,\n';

/** 料率の CSV 取込・切替・履歴（カタログ1章・6章）。取り込む前に今の料率との差を確かめる */
@Component({
  selector: 'app-rate-management',
  standalone: true,
  imports: [MatFormFieldModule, MatInputModule, FormsModule, RouterLink, MatButtonModule],
  template: `
    <div class="section">
      <p class="sub">新しい料率を CSV で取り込みます。料率は‰（例：健康保険 99.1）で書きます。本人・会社の欄が空なら折半です（子ども・子育て拠出金は会社だけ）。
        切り替えると、前の料率は「いつまで」が付いて履歴に残ります。<a routerLink="/grade-table">保険料額表を見る</a></p>
      <mat-form-field appearance="outline" subscriptSizing="dynamic" class="file"><mat-label>CSV ファイル</mat-label><input matInput type="file" accept=".csv,text/csv" (change)="pick($event)"></mat-form-field>
      <textarea rows="6" [(ngModel)]="csv" name="csv" [placeholder]="sample"></textarea>
      <div class="actions">
        <button mat-stroked-button type="button" (click)="csv = sample">書き方の例を入れる</button>
        <button mat-flat-button color="primary" type="button" (click)="preview()" [disabled]="busy() || !csv.trim()">確かめる</button>
      </div>

      @if (errors().length) { <ul class="errors">@for (e of errors(); track $index) { <li>{{ e }}</li> }</ul> }
      @if (items().length) {
        <table><thead><tr><th>行</th><th>種類</th><th>都道府県</th><th>開始</th><th class="num">今の料率</th><th class="num">新しい料率</th><th class="num">差</th><th class="num">本人／会社</th></tr></thead><tbody>
          @for (i of items(); track i.line) {
            <tr [class.dup]="i.duplicate"><td>{{ i.line }}</td><td>{{ i.typeLabel }}</td><td>{{ i.prefectureCode || '全国' }}</td><td>{{ i.appliedFrom }}</td>
              <td class="num">{{ i.current ? i.current.totalRate + '‰（' + i.current.appliedFrom + '〜）' : 'なし' }}</td><td class="num"><b>{{ i.totalRate }}‰</b></td>
              <td class="num">{{ i.change === null ? '' : (i.change > 0 ? '+' : '') + i.change }}</td><td class="num">{{ i.employeeRate }}／{{ i.employerRate }}</td></tr>
          }
        </tbody></table>
        @if (hasDuplicate()) { <p class="errors">同じ開始月の料率がもう登録されている行があります（色の付いた行）。CSV から外してください。</p> }
        <h3>切替月以降で、すでに計算した保険料</h3>
        @if (impact().length) {
          <p class="sub">切り替えたあと、未確定の人は毎月の処理で「計算し直しが必要」、確定済みの人は「訂正が必要」と出ます（料率の値が同じなら出ません）。自動では計算し直しません。
            切り替える前に新しい料率での額を見るなら <a routerLink="/simulation">試算の「料率改定」</a> を使います。</p>
          <table><thead><tr><th>事業所</th><th>月</th><th>種類</th><th class="num">未確定</th><th class="num">依頼中</th><th class="num">確定済み</th></tr></thead><tbody>
            @for (r of impact(); track r.officeId + r.kind + r.yearMonth) {
              <tr><td>{{ r.officeName }}</td><td>{{ r.yearMonth }}</td><td>{{ r.kind === 'monthly' ? '毎月' : '賞与' }}</td>
                <td class="num">{{ r.unconfirmed || '' }}</td><td class="num">{{ r.pending || '' }}</td><td class="num" [class.warn]="r.confirmed > 0">{{ r.confirmed || '' }}</td></tr>
            }
          </tbody></table>
        } @else { <p class="sub">切替月以降に計算した保険料はありません。</p> }
        <button mat-flat-button color="primary" type="button" (click)="apply()" [disabled]="busy() || errors().length > 0 || hasDuplicate()">この内容で取り込んで切り替える</button>
      }

      <h3>組合健保の料率を登録する</h3>
      <p class="sub">組合健保の事業所（設定の「事業所」で区分を組合健保にした事業所）は、ここで登録した保険者番号の料率だけで計算します。本人と会社の負担割合が折半でなければ、本人負担を入れます。</p>
      <div class="union">
        <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>保険者番号</mat-label><input matInput [(ngModel)]="union.insurerId" name="uInsurer" maxlength="20"></mat-form-field>
        <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>適用開始年月</mat-label><input matInput [(ngModel)]="union.appliedFrom" name="uFrom" placeholder="2027-03" maxlength="7"></mat-form-field>
        <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>健康保険料率（‰）</mat-label><input matInput type="number" [(ngModel)]="union.healthTotal" name="uHealth" step="0.01"></mat-form-field>
        <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>うち本人負担（‰）</mat-label><input matInput type="number" [(ngModel)]="union.healthEmployee" name="uHealthEmp" step="0.01"></mat-form-field>
        <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>介護保険料率（‰、任意）</mat-label><input matInput type="number" [(ngModel)]="union.careTotal" name="uCare" step="0.01"></mat-form-field>
        <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>うち本人負担（‰）</mat-label><input matInput type="number" [(ngModel)]="union.careEmployee" name="uCareEmp" step="0.01"></mat-form-field>
      </div>
      @if (union.healthTotal && union.healthEmployee !== null) {
        <p class="sub">会社負担 {{ round(union.healthTotal - (union.healthEmployee ?? 0)) }}‰（本人：会社 ＝ {{ ratio(union.healthEmployee ?? 0, union.healthTotal) }}）</p>
      }
      <button mat-stroked-button type="button" (click)="addUnion()" [disabled]="busy() || !union.insurerId || !union.appliedFrom || !union.healthTotal || union.healthEmployee === null">組合健保の料率を登録する</button>

      <h3>料率の履歴</h3>
      <table><thead><tr><th>種類</th><th>都道府県</th><th>適用期間</th><th class="num">料率</th><th class="num">本人／会社</th><th>備考</th></tr></thead><tbody>
        @for (h of history(); track $index) {
          <tr><td>{{ h.typeLabel }}</td><td>{{ h.prefectureCode || '全国' }}{{ h.insurerId ? '・' + h.insurerId : '' }}</td><td>{{ h.appliedFrom }}〜{{ h.appliedUntil ?? '' }}</td><td class="num">{{ h.totalRate }}‰</td><td class="num">{{ h.employeeRate }}／{{ h.employerRate }}</td><td class="small">{{ h.note }}</td></tr>
        }
      </tbody></table>
    </div>
  `,
  styles: [`
    .section { padding: 24px 0; }
    .sub { color: var(--app-color-text-sub); font-size: var(--app-font-sm); }
    .file { display: block; margin: 8px 0; font-size: var(--app-font-sm); }
    textarea { width: 100%; font-family: monospace; font-size: 12px; padding: 8px; box-sizing: border-box; }
    .actions { display: flex; gap: 8px; margin: 8px 0 16px; }
    table { width: 100%; border-collapse: collapse; font-size: var(--app-font-sm); margin-bottom: 12px; }
    td, th { padding: 4px 6px; border-bottom: 1px solid var(--app-color-border); text-align: left; }
    .num { text-align: right; } .small { font-size: var(--app-font-xs); color: var(--app-color-text-sub); }
    tr.dup td { background: var(--app-status-error-bg); }
    td.warn { color: var(--app-status-error-fg); font-weight: 600; }
    .union { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px 16px; margin: 8px 0; font-size: var(--app-font-sm); }
    .union label { display: flex; flex-direction: column; gap: 2px; }
    .union input:not(.mat-mdc-input-element) { padding: 6px 8px; font: inherit; }
    .errors { color: var(--app-status-error-fg); font-size: var(--app-font-sm); }
    h3 { margin: 24px 0 8px; }
  `],
})
export class RateManagementComponent implements OnInit {
  private functions = inject(Functions);
  private auth = inject(AuthService);
  private snackBar = inject(MatSnackBar);
  private confirm = inject(ConfirmService);

  sample = SAMPLE;
  csv = '';
  busy = signal(false);
  items = signal<PreviewItem[]>([]);
  errors = signal<string[]>([]);
  impact = signal<ImpactRow[]>([]);
  history = signal<HistoryItem[]>([]);

  union: { insurerId: string; appliedFrom: string; healthTotal: number | null; healthEmployee: number | null; careTotal: number | null; careEmployee: number | null } = {
    insurerId: '', appliedFrom: '', healthTotal: null, healthEmployee: null, careTotal: null, careEmployee: null,
  };

  ngOnInit() { void this.loadHistory(); }
  round(n: number) { return Math.round(n * 1000) / 1000; }
  ratio(employee: number, total: number) { return total ? `${this.round((employee / total) * 100)}：${this.round(100 - (employee / total) * 100)}` : ''; }

  async addUnion() {
    const u = this.union;
    const ok = await this.confirm.ask({
      title: '組合健保の料率を登録しますか',
      message: `保険者番号 ${u.insurerId} の料率を ${u.appliedFrom} から使います。同じ保険者番号の前の料率には終わりの月が付きます。`,
      items: [`健康保険 ${u.healthTotal}‰（本人 ${u.healthEmployee}‰）`, ...(u.careTotal ? [`介護保険 ${u.careTotal}‰（本人 ${u.careEmployee}‰）`] : [])],
      confirmLabel: '登録する',
    });
    if (!ok) return;
    this.busy.set(true);
    try {
      await httpsCallable(this.functions, 'rateUnionAdd')({
        companyId: this.auth.companyId, insurerId: u.insurerId.trim(), appliedFrom: u.appliedFrom.trim(),
        healthTotal: Number(u.healthTotal), healthEmployee: Number(u.healthEmployee),
        careTotal: u.careTotal ? Number(u.careTotal) : null, careEmployee: u.careTotal ? Number(u.careEmployee ?? Number(u.careTotal) / 2) : null, note: '組合健保',
      });
      this.snackBar.open('組合健保の料率を登録しました', '閉じる', { duration: 5000 });
      this.union = { insurerId: '', appliedFrom: '', healthTotal: null, healthEmployee: null, careTotal: null, careEmployee: null };
      await this.loadHistory();
    } catch (e: any) {
      this.snackBar.open(`登録できませんでした：${e?.message ?? ''}`, '閉じる', { duration: 8000 });
    } finally {
      this.busy.set(false);
    }
  }
  hasDuplicate() { return this.items().some(i => i.duplicate); }

  async pick(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) this.csv = await file.text();
  }

  async loadHistory() {
    const { data } = await httpsCallable<object, { items: HistoryItem[] }>(this.functions, 'rateHistoryList')({ companyId: this.auth.companyId });
    this.history.set(data.items);
  }

  async preview() {
    this.busy.set(true);
    try {
      const { data } = await httpsCallable<object, { items: PreviewItem[]; errors: string[]; impact?: ImpactRow[] }>(this.functions, 'rateImportPreview')({ companyId: this.auth.companyId, csv: this.csv });
      this.items.set(data.items);
      this.errors.set(data.errors);
      this.impact.set(data.impact ?? []);
    } catch (e: any) {
      this.snackBar.open(`確かめられませんでした：${e?.message ?? ''}`, '閉じる', { duration: 6000 });
    } finally {
      this.busy.set(false);
    }
  }

  async apply() {
    const ok = await this.confirm.ask({
      title: '料率を取り込んで切り替えますか',
      message: '開始月より後の保険料の計算に新しい料率が使われます。すでに計算した月は、計算し直すまで前の料率のままです（確定済みの月は訂正して計算し直します）。',
      count: `${this.items().length}件`,
      items: this.items().map(i => `${i.typeLabel}（${i.prefectureCode || '全国'}）${i.appliedFrom}〜 ${i.totalRate}‰`),
      confirmLabel: '取り込む',
    });
    if (!ok) return;
    this.busy.set(true);
    try {
      const { data } = await httpsCallable<object, { added: number; closedPrevious: number }>(this.functions, 'rateImportApply')({ companyId: this.auth.companyId, csv: this.csv });
      this.snackBar.open(`${data.added}件の料率を取り込みました（前の料率 ${data.closedPrevious}件に終わりの月を付けました）`, '閉じる', { duration: 6000 });
      this.items.set([]); this.csv = '';
      await this.loadHistory();
    } catch (e: any) {
      this.snackBar.open(`取り込めませんでした：${e?.message ?? ''}`, '閉じる', { duration: 8000 });
    } finally {
      this.busy.set(false);
    }
  }
}
