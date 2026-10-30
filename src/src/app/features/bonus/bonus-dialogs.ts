import { Component, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { BonusPayment, BonusRow, FilingDetail, monthLabel } from './bonus.types';

/**
 * 1人分の賞与（右のパネルの中身）。支給の内訳（同じ月に複数回なら行を足す）・年度の累計・保険料の内訳を見て、承認前なら直す。
 * 保存すると支給の一覧を save に出す（空の一覧は登録を消す）。計算はサーバーで行い、ここでは目安の合計だけ出す
 */
@Component({
  selector: 'app-bonus-person',
  standalone: true,
  imports: [DecimalPipe, FormsModule, RouterLink, MatButtonModule, MatIconModule],
  template: `
    @let r = row();
    @let b = r.bonus;
    @if (r.hold) { <p class="msg hold">保留中：{{ r.hold.reason }}</p> }
    @if (r.rejected.bonus && !b?.confirmed && !b?.pending) { <p class="msg bad">賞与額が差し戻されました。理由：{{ r.rejected.bonus }}</p> }
    @if (r.rejected.premium && !r.premium?.confirmed && !r.premium?.pending) { <p class="msg bad">保険料が差し戻されました。理由：{{ r.rejected.premium }}</p> }
    @for (i of r.issues; track i) { <p class="msg bad">{{ i }}</p> }
    @if (r.target === 'excluded') { <p class="msg bad">{{ r.targetReason }}</p> }
    @for (w of r.warnings; track w) { <p class="msg warn">{{ w }}</p> }

    <h3>{{ month() }}の支給</h3>
    @if (canEdit()) {
      <table>
        <thead><tr><th>支給日</th><th class="num">賞与額（通貨）</th><th class="num">現物</th><th></th></tr></thead>
        <tbody>
          @for (p of payments(); track $index; let i = $index) {
            <tr>
              <td><input type="date" [ngModel]="p.date" (ngModelChange)="set(i, 'date', $event)" [min]="payMonth() + '-01'" [max]="lastDay()" [attr.aria-label]="(i + 1) + '回目の支給日'"></td>
              <td class="num"><input type="number" min="0" step="1" [ngModel]="p.cash" (ngModelChange)="set(i, 'cash', $event)" [attr.aria-label]="(i + 1) + '回目の賞与額'"></td>
              <td class="num"><input type="number" min="0" step="1" [ngModel]="p.inKind" (ngModelChange)="set(i, 'inKind', $event)" [attr.aria-label]="(i + 1) + '回目の現物'"></td>
              <td><button mat-icon-button type="button" (click)="remove(i)" [attr.aria-label]="(i + 1) + '回目の支給を消す'"><mat-icon>delete</mat-icon></button></td>
            </tr>
          }
        </tbody>
      </table>
      <div class="row-actions">
        <button mat-stroked-button type="button" (click)="add()" [disabled]="payments().length >= 10"><mat-icon>add</mat-icon>{{ payments().length ? '同じ月の別の支給を足す' : '支給を入れる' }}</button>
        @if (b) { <button mat-button type="button" class="danger" (click)="save.emit([])" [disabled]="busy()">登録を消す</button> }
        <button mat-flat-button type="button" class="save" (click)="submit()" [disabled]="busy() || !payments().length">保存する</button>
      </div>
      @if (error()) { <p class="msg bad" role="alert">{{ error() }}</p> }
    } @else if (b) {
      <table>
        <thead><tr><th>支給日</th><th class="num">賞与額（通貨）</th><th class="num">現物</th></tr></thead>
        <tbody>
          @for (p of b.payments; track p.date) { <tr><td>{{ p.date || '未登録' }}</td><td class="num">{{ p.cash | number }}円</td><td class="num">{{ p.inKind | number }}円</td></tr> }
        </tbody>
      </table>
      <p class="sub">{{ b.confirmed ? '承認済みのため変更できません。直すときは承認の画面で差し戻してもらいます。' : '承認の依頼中のため変更できません。' }}
        @if (b.pending || r.premium?.pending) { <a routerLink="/approvals">承認の画面で見る</a> }</p>
    }

    <h3>標準賞与額</h3>
    <dl>
      <dt>賞与額の合計</dt><dd>{{ total() | number }}円</dd>
      <dt>標準賞与額</dt><dd>{{ standard() | number }}円<span class="sub">（1,000円未満を切り捨て）</span></dd>
    </dl>
    @if (r.caps; as c) {
      <h3>年度の累計（健保の上限 573万円）</h3>
      <dl>
        <dt>前の月まで</dt><dd>{{ c.priorHealthCumulative | number }}円</dd>
        <dt>今回を含めて</dt><dd [class.bad]="c.priorHealthCumulative + standard() > 5730000">{{ c.priorHealthCumulative + standard() | number }}円</dd>
      </dl>
    }
    @if (r.premium; as p) {
      <h3>保険料</h3>
      <dl>
        <dt>保険料の対象</dt><dd>健保 {{ p.healthCapped | number }}円・厚年 {{ p.pensionCapped | number }}円</dd>
        <dt>本人負担</dt><dd>{{ p.employee | number }}円</dd>
        <dt>会社負担</dt><dd>{{ p.employer | number }}円</dd>
        <dt>状態</dt><dd>{{ p.exempted ? '産休・育休で免除・' : '' }}{{ p.confirmed ? '承認済み' : p.pending ? '承認待ち' : '承認の依頼前' }}</dd>
      </dl>
    }
    @if (r.age70) { <p class="sub">70歳以上：厚生年金の保険料はかかりません（届出は70歳以上被用者として出します）。</p> }
  `,
  styles: [`
    .msg { margin: 0 0 8px; padding: 6px 10px; border-radius: 6px; line-height: 1.6; font-size: 13px; }
    .msg.bad { color: var(--app-status-error-fg); background: var(--app-status-error-bg); }
    .msg.warn { color: var(--app-status-attention-fg); background: var(--app-status-attention-bg); }
    .msg.hold { color: var(--app-status-waiting-fg); background: var(--app-status-waiting-bg); }
    h3 { margin: 18px 0 8px; font-size: 12px; font-weight: 700; color: var(--app-color-text-sub); letter-spacing: .04em; }
    .sub { color: var(--app-color-text-sub); font-size: 12px; line-height: 1.6; }
    .sub a { color: var(--app-color-link); }
    .bad { color: var(--app-status-error-fg); }
    .danger { color: var(--app-status-error-fg); }
    table { border-collapse: collapse; width: 100%; font-size: 13px; margin: 4px 0 8px; }
    th, td { padding: 4px 6px; border-bottom: 1px solid var(--app-color-border); text-align: left; }
    th { font-size: 12px; color: var(--app-color-text-sub); font-weight: 600; }
    .num { text-align: right; white-space: nowrap; }
    td input { font: inherit; padding: 4px 6px; width: 100%; max-width: 9.5em; box-sizing: border-box; }
    td.num input { text-align: right; }
    .row-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .row-actions .save { margin-left: auto; }
    dl { display: grid; grid-template-columns: 8em 1fr; gap: 6px 12px; margin: 0; font-size: 13px; }
    dt { color: var(--app-color-text-sub); }
    dd { margin: 0; }
  `],
})
export class BonusPersonComponent {
  row = input.required<BonusRow>();
  payMonth = input.required<string>();
  canEdit = input(false);
  busy = input(false);
  save = output<BonusPayment[]>();

  month = computed(() => monthLabel(this.payMonth()));
  lastDay = computed(() => { const [y, m] = this.payMonth().split('-').map(Number); return `${this.payMonth()}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`; });
  /** 入力中の支給。別の人に切り替えたとき・読み込み直したときは、その人の登録内容に戻す */
  payments = linkedSignal<BonusPayment[]>(() => {
    const b = this.row().bonus;
    return b ? b.payments.map(p => ({ ...p })) : [{ date: `${this.payMonth()}-10`, cash: 0, inKind: 0 }];
  });
  total = computed(() => this.payments().reduce((a, p) => a + (Number(p.cash) || 0) + (Number(p.inKind) || 0), 0));
  standard = computed(() => Math.floor(this.total() / 1000) * 1000);
  error = linkedSignal<string>(() => { this.row(); return ''; });

  set(i: number, key: keyof BonusPayment, value: string | number) {
    this.payments.update(list => list.map((p, k) => k === i ? { ...p, [key]: key === 'date' ? String(value) : Math.max(0, Math.floor(Number(value) || 0)) } : p));
  }
  add() { this.payments.update(list => [...list, { date: this.lastDay(), cash: 0, inKind: 0 }]); }
  remove(i: number) { this.payments.update(list => list.filter((_, k) => k !== i)); }

  submit() {
    const list = this.payments();
    const month = this.payMonth();
    if (list.some(p => !p.date.startsWith(`${month}-`))) return this.error.set(`支給日は${this.month()}の日付にしてください`);
    if (list.some(p => p.cash + p.inKind <= 0)) return this.error.set('支給額が0円の行があります');
    if (new Set(list.map(p => p.date)).size !== list.length) return this.error.set('同じ支給日が2回あります（同じ日の支給は1行にまとめてください）');
    this.save.emit(list);
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
