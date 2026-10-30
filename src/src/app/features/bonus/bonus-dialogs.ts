import { Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { BonusPayment, BonusRow, FilingDetail, monthLabel } from './bonus.types';

/**
 * 1人分の賞与。支給の内訳（同じ月に複数回なら行を足す）・年度の累計・保険料の内訳を見て、承認前なら直す。
 * 閉じるときに支給の一覧を返す（空の一覧は登録を消す）。計算はサーバーで行い、ここでは目安の合計だけ出す
 */
@Component({
  selector: 'app-bonus-entry-dialog',
  standalone: true,
  imports: [DecimalPipe, FormsModule, RouterLink, MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <h2 mat-dialog-title>{{ r.name }}（{{ r.employeeNumber }}）・{{ month(data.payMonth) }}の賞与</h2>
    <mat-dialog-content>
      @if (r.hold) { <p class="hold">保留中：{{ r.hold.reason }}</p> }
      @if (r.rejected.bonus && !b?.confirmed && !b?.pending) { <p class="bad">賞与額が差し戻されました。理由：{{ r.rejected.bonus }}</p> }
      @if (r.rejected.premium && !r.premium?.confirmed && !r.premium?.pending) { <p class="bad">保険料が差し戻されました。理由：{{ r.rejected.premium }}</p> }
      @for (i of r.issues; track i) { <p class="bad">{{ i }}</p> }
      @if (r.target === 'excluded') { <p class="bad">{{ r.targetReason }}</p> }
      @for (w of r.warnings; track w) { <p class="warn">{{ w }}</p> }

      <h3>支給の内訳</h3>
      @if (data.canEdit) {
        <table>
          <thead><tr><th>支給日</th><th class="num">賞与額（通貨）</th><th class="num">現物</th><th></th></tr></thead>
          <tbody>
            @for (p of payments(); track $index; let i = $index) {
              <tr>
                <td><input type="date" [ngModel]="p.date" (ngModelChange)="set(i, 'date', $event)" [min]="data.payMonth + '-01'" [max]="lastDay" [attr.aria-label]="(i + 1) + '回目の支給日'"></td>
                <td class="num"><input type="number" min="0" step="1" [ngModel]="p.cash" (ngModelChange)="set(i, 'cash', $event)" [attr.aria-label]="(i + 1) + '回目の賞与額'"></td>
                <td class="num"><input type="number" min="0" step="1" [ngModel]="p.inKind" (ngModelChange)="set(i, 'inKind', $event)" [attr.aria-label]="(i + 1) + '回目の現物'"></td>
                <td><button mat-icon-button type="button" (click)="remove(i)" [attr.aria-label]="(i + 1) + '回目の支給を消す'"><mat-icon>delete</mat-icon></button></td>
              </tr>
            }
          </tbody>
        </table>
        <button mat-stroked-button type="button" (click)="add()" [disabled]="payments().length >= 10"><mat-icon>add</mat-icon>{{ payments().length ? '同じ月の別の支給を足す' : '支給を入れる' }}</button>
        <p class="sub">同じ月に2回以上支給したときは、合算して標準賞与額を決めます（届出には初回の支給日と合算額を書きます）。</p>
      } @else if (b) {
        <table>
          <thead><tr><th>支給日</th><th class="num">賞与額（通貨）</th><th class="num">現物</th></tr></thead>
          <tbody>
            @for (p of b.payments; track p.date) { <tr><td>{{ p.date || '未登録' }}</td><td class="num">{{ p.cash | number }}円</td><td class="num">{{ p.inKind | number }}円</td></tr> }
          </tbody>
        </table>
        <p class="sub">{{ b.confirmed ? '承認済みのため変更できません。直すときは承認の画面で差し戻してもらいます。' : '承認の依頼中のため変更できません。' }}</p>
      }

      <dl>
        <div><dt>賞与額の合計</dt><dd>{{ total() | number }}円</dd></div>
        <div><dt>標準賞与額</dt><dd>{{ standard() | number }}円（1,000円未満を切り捨て）</dd></div>
        @if (r.caps; as c) {
          <div><dt>健保の年度累計</dt><dd>前の月まで {{ c.priorHealthCumulative | number }}円 → 今回を含めて {{ c.priorHealthCumulative + standard() | number }}円（上限 5,730,000円）</dd></div>
        }
        @if (r.premium; as p) {
          <div><dt>保険料の対象</dt><dd>健保 {{ p.healthCapped | number }}円・厚年 {{ p.pensionCapped | number }}円</dd></div>
          <div><dt>保険料</dt><dd>本人 {{ p.employee | number }}円・会社 {{ p.employer | number }}円{{ p.exempted ? '（産休・育休で免除）' : '' }}{{ p.confirmed ? '（承認済み）' : p.pending ? '（承認待ち）' : '' }}</dd></div>
        }
        @if (r.age70) { <div><dt>70歳以上</dt><dd>厚生年金の保険料はかかりません（届出は70歳以上被用者として出します）</dd></div> }
      </dl>
      @if (error()) { <p class="bad" role="alert">{{ error() }}</p> }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      @if (b?.pending || r.premium?.pending) { <a mat-stroked-button routerLink="/approvals" mat-dialog-close>承認の画面で見る</a> }
      @if (data.canEdit && b) { <button mat-button type="button" class="danger" (click)="clear()">登録を消す</button> }
      <button mat-button mat-dialog-close type="button">{{ data.canEdit ? 'やめる' : '閉じる' }}</button>
      @if (data.canEdit) { <button mat-flat-button type="button" (click)="save()" [disabled]="!payments().length">保存する</button> }
    </mat-dialog-actions>
  `,
  styles: [`
    p { line-height: 1.7; margin: 0 0 8px; }
    h3 { margin: 8px 0; font-size: 15px; font-weight: 500; }
    .sub { color: var(--app-color-text-sub); }
    .bad { color: var(--app-status-action-fg); }
    .warn { color: var(--app-status-yours-fg); }
    .hold { color: var(--app-status-waiting-fg); }
    .danger { color: var(--app-status-action-fg); }
    table { border-collapse: collapse; width: 100%; font-size: 13px; margin: 4px 0 8px; }
    th, td { padding: 4px 8px; border-bottom: 1px solid var(--app-color-border); text-align: left; }
    .num { text-align: right; white-space: nowrap; }
    td input { font: inherit; padding: 4px 6px; max-width: 11em; }
    td.num input { text-align: right; }
    dl { display: grid; gap: 4px; margin: 12px 0 8px; }
    dl div { display: grid; grid-template-columns: 9em 1fr; gap: 8px; }
    dt { color: var(--app-color-text-sub); }
    dd { margin: 0; }
  `],
})
export class BonusEntryDialogComponent {
  data = inject<{ row: BonusRow; payMonth: string; canEdit: boolean }>(MAT_DIALOG_DATA);
  private ref = inject(MatDialogRef<BonusEntryDialogComponent>);
  r = this.data.row;
  b = this.r.bonus;
  lastDay = (() => { const [y, m] = this.data.payMonth.split('-').map(Number); return `${this.data.payMonth}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`; })();
  payments = signal<BonusPayment[]>(this.b ? this.b.payments.map(p => ({ ...p })) : [{ date: `${this.data.payMonth}-10`, cash: 0, inKind: 0 }]);
  total = computed(() => this.payments().reduce((a, p) => a + (Number(p.cash) || 0) + (Number(p.inKind) || 0), 0));
  standard = computed(() => Math.floor(this.total() / 1000) * 1000);
  error = signal('');

  month(ym: string) { return monthLabel(ym); }
  set(i: number, key: keyof BonusPayment, value: string | number) {
    this.payments.update(list => list.map((p, k) => k === i ? { ...p, [key]: key === 'date' ? String(value) : Math.max(0, Math.floor(Number(value) || 0)) } : p));
  }
  add() { this.payments.update(list => [...list, { date: this.lastDay, cash: 0, inKind: 0 }]); }
  remove(i: number) { this.payments.update(list => list.filter((_, k) => k !== i)); }
  clear() { this.ref.close([]); }

  save() {
    const list = this.payments();
    const month = this.data.payMonth;
    if (list.some(p => !p.date.startsWith(`${month}-`))) return this.error.set(`支給日は${this.month(month)}の日付にしてください`);
    if (list.some(p => p.cash + p.inKind <= 0)) return this.error.set('支給額が0円の行があります');
    if (new Set(list.map(p => p.date)).size !== list.length) return this.error.set('同じ支給日が2回あります（同じ日の支給は1行にまとめてください）');
    this.ref.close(list);
  }
}

/** 届出の中身（人ごとの行）と公式様式のPDF */
@Component({
  selector: 'app-bonus-filing-dialog',
  standalone: true,
  imports: [DecimalPipe, MatDialogModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>{{ month(data.payMonth) }}支給 賞与支払届（{{ f.number }}件目・{{ f.persons.length }}名）</h2>
    <mat-dialog-content>
      <p class="sub">
        {{ f.header['事業所名称'] }}・賞与支払年月日（共通）{{ f.header['賞与支払年月日'] }}・期限 {{ f.deadline }}。中身は承認された賞与額から作っています。
        同じ月に2回以上支給した人は、初回の支給日と合算額を書き、備考に「同一月内の賞与合算」を付けます。
      </p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>整理番号</th><th>氏名</th><th>生年月日</th><th>支払日</th><th class="num">通貨</th><th class="num">現物</th><th class="num">合計（千円未満切捨て）</th><th>備考</th></tr>
          </thead>
          <tbody>
            @for (p of f.persons; track p.employeeId) {
              <tr>
                <td>{{ p['被保険者整理番号'] || '未登録' }}</td>
                <td>{{ p['被保険者氏名'] }}</td>
                <td>{{ p['生年月日'] }}</td>
                <td>{{ p['賞与支払年月日'] }}</td>
                <td class="num">{{ p['賞与額_通貨'] | number }}</td>
                <td class="num">{{ p['賞与額_現物'] | number }}</td>
                <td class="num">{{ p['標準賞与額'] | number }}</td>
                <td>{{ notes(p['備考区分'], p['初回支払日']) }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-stroked-button type="button" (click)="pdf()" [disabled]="working()">公式様式のPDFを作る</button>
      <button mat-button mat-dialog-close type="button">閉じる</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .sub { color: var(--app-color-text-sub); line-height: 1.7; }
    .table-wrap { overflow: auto; max-height: 60vh; }
    table { border-collapse: collapse; width: 100%; font-size: 12px; }
    th, td { padding: 4px 6px; border-bottom: 1px solid var(--app-color-border); text-align: left; vertical-align: top; }
    th { background: var(--app-color-surface-sub); position: sticky; top: 0; }
    .num { text-align: right; white-space: nowrap; }
  `],
})
export class BonusFilingDialogComponent {
  data = inject<{ filing: FilingDetail; payMonth: string }>(MAT_DIALOG_DATA);
  f = this.data.filing;
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  working = signal(false);

  month(ym: string) { return monthLabel(ym); }
  notes(codes: number[], firstDay: number | null) {
    return codes.map(c => c === 1 ? '70歳以上被用者' : c === 3 ? `同一月内の賞与合算（初回支払日 ${firstDay}日）` : String(c)).join('・');
  }

  async pdf() {
    this.working.set(true);
    try {
      const [{ createBonusFilingPdf, OFFICIAL_FORMS }, { OfficialPdfPreviewComponent }] = await Promise.all([
        import('../filings/templates/official-filing-pdf'), import('../filings/templates/official-pdf-preview'),
      ]);
      const h = this.f.header;
      const output = await createBonusFilingPdf(h, this.f.persons, {
        companyName: String(h['会社名'] ?? ''), officeName: String(h['事業所名称'] ?? ''), officeNumber: String(h['事業所整理記号'] ?? ''),
        officeAddress: String(h['事業所所在地'] ?? ''), officePhone: String(h['電話番号'] ?? ''), representativeName: String(h['事業主氏名'] ?? ''),
        effectiveDate: this.f.submission?.date ?? new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }),
      });
      const form = OFFICIAL_FORMS['bonusPayment'];
      this.dialog.open(OfficialPdfPreviewComponent, {
        width: '1100px', height: '94vh', maxWidth: '96vw',
        data: { ...output, title: form.title, filename: `${form.title}_${this.data.payMonth}_${this.f.number}.pdf`,
          sourceUrl: `https://www.nenkin.go.jp/shinsei/kounen/tekiyo/${form.source}`, originalUrl: `/filing-forms/${form.file}.pdf` },
      });
    } catch (e) {
      this.snackBar.open(e instanceof Error ? e.message : 'PDFを作れませんでした', '閉じる', { duration: 6000 });
    } finally {
      this.working.set(false);
    }
  }
}
