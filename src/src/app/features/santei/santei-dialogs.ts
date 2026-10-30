import { Component, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { FilingDetail, INSURED_CATEGORY_LABELS, SanteiRow, gradeChangeText } from './santei.types';

/** 1人分の4〜6月の内訳と判定。支払基礎日数が足りない人の決め方はここでも選べる */
@Component({
  selector: 'app-santei-detail-dialog',
  standalone: true,
  imports: [DecimalPipe, RouterLink, MatDialogModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>{{ r.employeeName }}（{{ r.employeeNumber }}）</h2>
    <mat-dialog-content>
      @if (r.hold) { <p class="hold">保留中：{{ r.hold.reason }}</p> }
      <p [class.bad]="r.status === 'needsAction' || r.status === 'pending'">{{ r.reason }}</p>
      @if (r.approval.status === 'rejected') { <p class="bad">差し戻されました。理由：{{ r.approval.rejection }}</p> }
      @if (r.septemberTaken) { <p class="bad">{{ data.year }}年9月の等級が、定時決定以外（手入力など）で既に登録されています。</p> }
      <p class="sub">被保険者の区分：{{ categoryLabels[r.insuredCategory] }}</p>

      @if (r.months.length) {
        <table>
          <thead><tr><th>支払月</th><th class="num">支払基礎日数</th><th class="num">通貨</th><th class="num">現物</th><th class="num">判定に使う額</th><th>平均に</th></tr></thead>
          <tbody>
            @for (m of r.months; track m.yearMonth) {
              <tr>
                <td>{{ month(m.yearMonth) }}</td>
                <td class="num">{{ m.paymentBasisDays ?? '—' }}{{ m.paymentBasisDays !== null ? '日' : '' }}</td>
                <td class="num">{{ m.cash !== null ? (m.cash | number) + '円' : '未登録' }}</td>
                <td class="num">{{ m.inKind ? (m.inKind | number) + '円' : '' }}</td>
                <td class="num">{{ m.remuneration !== null ? (m.remuneration | number) + '円' : '' }}{{ m.retroactive ? '（遡及差額 ' + (m.retroactive | number) + '円を除く）' : '' }}</td>
                <td>{{ m.used ? '使う' : (m.paymentBasisDays !== null ? '使わない' : '') }}</td>
              </tr>
            }
          </tbody>
        </table>
      }

      <dl>
        <div><dt>平均</dt><dd>{{ r.average !== null ? (r.average | number) + '円' : (r.basis === 'previous' ? '従前の標準報酬月額で決定' : '—') }}</dd></div>
        <div><dt>今の等級</dt><dd>
          @if (r.current; as c) { 健保 {{ c.healthGradeNumber }}等級（{{ c.healthStandardRemuneration | number }}円）・厚年 {{ c.pensionGradeNumber }}等級（{{ c.pensionStandardRemuneration | number }}円）{{ r.currentEffectiveMonth ? '　' + month(r.currentEffectiveMonth) + 'から' : '' }} }
          @else { なし }
        </dd></div>
        @if (r.proposed; as p) {
          <div><dt>{{ data.year }}年9月から</dt><dd [class.changed]="r.changed">健保 {{ p.healthGradeNumber }}等級（{{ p.healthStandardRemuneration | number }}円）・厚年 {{ p.pensionGradeNumber }}等級（{{ p.pensionStandardRemuneration | number }}円）</dd></div>
          <div><dt>変化</dt><dd>{{ change() }}</dd></div>
        }
        <div><dt>承認</dt><dd>{{ approvalLabel() }}</dd></div>
      </dl>

      @if (r.status === 'pending') {
        <p class="sub">給与の登録・承認は毎月の処理で行います。無給の休職などで決められない人は、一覧で保留にしてください（他の人の届出は進められます）。</p>
      }
      @if (r.status === 'needsAction' && r.current) {
        <p class="sub">支払基礎日数の基準を満たす月がないため、従前の標準報酬月額（今の等級）で決めるのが原則です。休職で給与がない場合なども同じです。</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      @if (r.status === 'pending') {
        <a mat-stroked-button routerLink="/monthly" [queryParams]="{ officeId: data.officeId, payMonth: firstMissing() }" mat-dialog-close>毎月の処理を開く</a>
      }
      @if (r.status === 'needsAction' && r.current && r.approval.status !== 'pending' && r.approval.status !== 'approved') {
        <button mat-flat-button type="button" mat-dialog-close="previous">従前の等級で決める</button>
      }
      @if (r.decision && r.approval.status !== 'pending' && r.approval.status !== 'approved') {
        <button mat-stroked-button type="button" mat-dialog-close="undo">決め方を取り消す</button>
      }
      @if (r.approval.status === 'pending') {
        <a mat-stroked-button routerLink="/approvals" mat-dialog-close>承認の画面で見る</a>
      }
      <button mat-button mat-dialog-close type="button">閉じる</button>
    </mat-dialog-actions>
  `,
  styles: [`
    p { line-height: 1.7; margin: 0 0 8px; }
    .sub { color: var(--app-color-text-sub); }
    .bad { color: var(--app-status-action-fg); }
    .hold { color: var(--app-status-waiting-fg); }
    .changed { color: var(--app-status-yours-fg); font-weight: 500; }
    table { border-collapse: collapse; width: 100%; font-size: 13px; margin: 8px 0 16px; }
    th, td { padding: 4px 8px; border-bottom: 1px solid var(--app-color-border); text-align: left; }
    .num { text-align: right; white-space: nowrap; }
    dl { display: grid; gap: 4px; margin: 0 0 8px; }
    dl div { display: grid; grid-template-columns: 8em 1fr; gap: 8px; }
    dt { color: var(--app-color-text-sub); }
    dd { margin: 0; }
  `],
})
export class SanteiDetailDialogComponent {
  data = inject<{ row: SanteiRow; year: number; officeId: string }>(MAT_DIALOG_DATA);
  r = this.data.row;
  categoryLabels = INSURED_CATEGORY_LABELS;

  month(ym: string) { const [y, m] = ym.split('-'); return `${y}年${Number(m)}月`; }
  change() { return gradeChangeText(this.r); }
  firstMissing() { return this.r.months.find(m => m.cash === null)?.yearMonth ?? `${this.data.year}-06`; }
  approvalLabel() {
    return ({ none: '依頼前', pending: '承認待ち', approved: '承認済み', rejected: '差し戻し' } as const)[this.r.approval.status];
  }
}

/** 届出の中身（人ごとの行）と公式様式のPDF */
@Component({
  selector: 'app-santei-filing-dialog',
  standalone: true,
  imports: [DecimalPipe, MatDialogModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>{{ data.year }}年 算定基礎届（{{ f.number }}件目・{{ f.persons.length }}名）</h2>
    <mat-dialog-content>
      <p class="sub">
        {{ f.header['事業所名称'] }}・適用年月 {{ data.year }}年9月。中身は承認された等級の申請内容から作っています。
        総計・平均額は支払基礎日数の基準を満たした月の支払額です。
      </p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>氏名</th><th>生年月日</th><th class="num">従前（健保／厚年）</th><th>4〜6月（日数・支払額）</th><th class="num">総計</th><th class="num">平均額</th><th class="num">修正平均額</th><th>決定（健保／厚年）</th><th>備考</th></tr>
          </thead>
          <tbody>
            @for (p of f.persons; track p.employeeId) {
              <tr>
                <td>{{ p['被保険者氏名'] }}</td>
                <td>{{ p['生年月日'] }}</td>
                <td class="num">{{ thousand(p['従前の標準報酬月額_健康保険']) }}／{{ thousand(p['従前の標準報酬月額_厚生年金']) }}</td>
                <td>@for (m of p.months; track m['月']) { <div>{{ m['月'] }}月 {{ m['支払基礎日数'] }}日 {{ m['合計'] | number }}円</div> }</td>
                <td class="num">{{ p['総計'] | number }}</td>
                <td class="num">{{ p['平均額'] !== null ? (p['平均額'] | number) : '—' }}</td>
                <td class="num">{{ p['修正平均額'] !== null ? (p['修正平均額'] | number) : '' }}</td>
                <td>{{ p['決定_健康保険等級'] }}等級 {{ thousand(p['決定_健康保険標準報酬月額']) }}／{{ p['決定_厚生年金等級'] }}等級 {{ thousand(p['決定_厚生年金標準報酬月額']) }}</td>
                <td>{{ p['備考'] }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <p class="sub">金額の「千円」は標準報酬月額を千円単位で示しています。</p>
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
export class SanteiFilingDialogComponent {
  data = inject<{ filing: FilingDetail; year: number }>(MAT_DIALOG_DATA);
  f = this.data.filing;
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  working = signal(false);

  thousand(v: number | null) { return v === null ? '—' : `${Math.floor(v / 1000).toLocaleString('ja-JP')}千円`; }

  async pdf() {
    this.working.set(true);
    try {
      const [{ createSanteiFilingPdf, OFFICIAL_FORMS }, { OfficialPdfPreviewComponent }] = await Promise.all([
        import('../filings/templates/official-filing-pdf'), import('../filings/templates/official-pdf-preview'),
      ]);
      const h = this.f.header;
      const output = await createSanteiFilingPdf(h, this.f.persons, {
        companyName: String(h['会社名'] ?? ''), officeName: String(h['事業所名称'] ?? ''), officeNumber: String(h['事業所整理記号'] ?? ''),
        officeAddress: String(h['事業所所在地'] ?? ''), officePhone: String(h['電話番号'] ?? ''), representativeName: String(h['事業主氏名'] ?? ''),
        effectiveDate: this.f.submission?.date ?? new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }),
      });
      const form = OFFICIAL_FORMS['remunerationMonthlyAlgorithm'];
      this.dialog.open(OfficialPdfPreviewComponent, {
        width: '1100px', height: '94vh', maxWidth: '96vw',
        data: { ...output, title: form.title, filename: `${form.title}_${this.data.year}_${this.f.number}.pdf`,
          sourceUrl: `https://www.nenkin.go.jp/shinsei/kounen/tekiyo/${form.source}`, originalUrl: `/filing-forms/${form.file}.pdf` },
      });
    } catch (e) {
      this.snackBar.open(e instanceof Error ? e.message : 'PDFを作れませんでした', '閉じる', { duration: 6000 });
    } finally {
      this.working.set(false);
    }
  }
}

/** 差し戻しの理由・提出した日などを1つ入れるダイアログ（type: 'none' は確認だけ） */
@Component({
  selector: 'app-santei-input-dialog',
  standalone: true,
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content>
      @if (data.text) { <p>{{ data.text }}</p> }
      @if (data.type !== 'none') {
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>{{ data.label }}</mat-label>
          <input matInput [type]="data.type" [(ngModel)]="value" maxlength="500" [required]="data.required">
        </mat-form-field>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">やめる</button>
      <button mat-flat-button type="button" [mat-dialog-close]="value.trim()" [disabled]="data.required && !value.trim()">{{ data.button }}</button>
    </mat-dialog-actions>
  `,
  styles: [`.full-width { width: 100%; } p { line-height: 1.7; }`],
})
export class SanteiInputDialogComponent {
  data = inject<{ title: string; label: string; type: 'text' | 'date' | 'none'; button: string; required: boolean; text?: string }>(MAT_DIALOG_DATA);
  value = this.data.type === 'date' ? new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }) : '';
}
