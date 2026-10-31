import { Component, OnInit, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../core/services/auth.service';
import { PageHeadComponent } from '../../shared/ui';

const PREFS = ['北海道', '青森', '岩手', '宮城', '秋田', '山形', '福島', '茨城', '栃木', '群馬', '埼玉', '千葉', '東京', '神奈川', '新潟', '富山', '石川', '福井', '山梨', '長野', '岐阜', '静岡', '愛知', '三重', '滋賀', '京都', '大阪', '兵庫', '奈良', '和歌山', '鳥取', '島根', '岡山', '広島', '山口', '徳島', '香川', '愛媛', '高知', '福岡', '佐賀', '長崎', '熊本', '大分', '宮崎', '鹿児島', '沖縄'];

interface Row { healthGrade: number; pensionGrade: number | null; standardRemuneration: number; lowerBound: number; upperBound: number; healthFull: number | null; healthHalf: number | null; careFull: number | null; careHalf: number | null; pensionFull: number | null; pensionHalf: number | null }
interface Table { yearMonth: string; prefectureCode: string; rates: { health: number; longTermCare: number | null; pension: number | null; healthFrom: string }; rows: Row[] }

/** 保険料額表の閲覧（カタログ1章）。都道府県と年月を選ぶと、その時点の料率で額表を出す */
@Component({
  selector: 'app-grade-table',
  standalone: true,
  imports: [DecimalPipe, FormsModule, MatButtonModule, PageHeadComponent],
  template: `
    <app-page-head heading="保険料額表" />
    <div class="form">
      <label>都道府県 <select [(ngModel)]="pref" name="pref">@for (p of prefs; track $index) { <option [value]="code($index)">{{ p }}</option> }</select></label>
      <label>年月 <input type="month" [(ngModel)]="yearMonth" name="ym"></label>
      <button mat-flat-button color="primary" type="button" (click)="load()" [disabled]="loading()">表示</button>
    </div>
    @if (error()) { <p class="error">{{ error() }}</p> }
    @if (t(); as t) {
      <p class="sub">健康保険 {{ t.rates.health }}‰（{{ t.rates.healthFrom }}から）・介護保険 {{ t.rates.longTermCare ?? '—' }}‰・厚生年金 {{ t.rates.pension ?? '—' }}‰。折半額は本人負担（50銭以下切り捨て）。</p>
      <div class="wrap"><table>
        <thead><tr><th rowspan="2">等級</th><th rowspan="2" class="num">標準報酬月額</th><th rowspan="2" class="num">報酬月額</th><th colspan="2">健康保険（介護なし）</th><th colspan="2">健康保険（介護あり）</th><th colspan="2">厚生年金</th></tr>
          <tr><th class="num">全額</th><th class="num">折半額</th><th class="num">全額</th><th class="num">折半額</th><th class="num">全額</th><th class="num">折半額</th></tr></thead>
        <tbody>@for (r of t.rows; track r.healthGrade) {
          <tr><td>{{ r.healthGrade }}{{ r.pensionGrade ? '（' + r.pensionGrade + '）' : '' }}</td><td class="num">{{ r.standardRemuneration | number }}</td>
            <td class="num">{{ r.lowerBound | number }}〜{{ r.upperBound >= 99999999 ? '' : (r.upperBound | number) }}</td>
            <td class="num">{{ r.healthFull | number: '1.0-2' }}</td><td class="num">{{ r.healthHalf | number }}</td>
            <td class="num">{{ r.careFull | number: '1.0-2' }}</td><td class="num">{{ r.careHalf | number }}</td>
            <td class="num">{{ r.pensionFull === null ? '' : (r.pensionFull | number: '1.0-2') }}</td><td class="num">{{ r.pensionHalf === null ? '' : (r.pensionHalf | number) }}</td></tr>
        }</tbody>
      </table></div>
    }
  `,
  styles: [`
    :host { display: block; padding: var(--app-space-5); }
    .form { display: flex; gap: 12px; align-items: flex-end; margin-bottom: 12px; flex-wrap: wrap; }
    .form label { display: flex; flex-direction: column; gap: 2px; font-size: var(--app-font-sm); color: var(--app-color-text-sub); }
    .form select, .form input { padding: 6px 8px; font: inherit; }
    .wrap { overflow-x: auto; }
    table { border-collapse: collapse; font-size: var(--app-font-sm); min-width: 820px; width: 100%; background: var(--app-color-surface); }
    td, th { padding: 3px 8px; border: 1px solid var(--app-color-border); }
    th { background: var(--app-color-surface-sub); font-weight: 600; }
    .num { text-align: right; } .sub { color: var(--app-color-text-sub); font-size: var(--app-font-sm); } .error { color: var(--app-status-error-fg); }
  `],
})
export class GradeTableComponent implements OnInit {
  private functions = inject(Functions);
  private auth = inject(AuthService);
  prefs = PREFS;
  pref = '13';
  yearMonth = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }).slice(0, 7);
  t = signal<Table | null>(null);
  loading = signal(false);
  error = signal('');

  code(i: number) { return String(i + 1).padStart(2, '0'); }
  ngOnInit() { void this.load(); }

  async load() {
    this.loading.set(true);
    this.error.set('');
    try {
      const { data } = await httpsCallable<object, Table>(this.functions, 'gradeTableGet')({ companyId: this.auth.companyId, prefectureCode: this.pref, yearMonth: this.yearMonth });
      this.t.set(data);
    } catch (e: any) {
      this.t.set(null);
      this.error.set(e?.message ?? '額表を出せませんでした');
    } finally {
      this.loading.set(false);
    }
  }
}
