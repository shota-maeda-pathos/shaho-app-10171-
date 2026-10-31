import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../core/services/auth.service';
import { OfficeContextService } from '../../core/services/office-context.service';

type Pair = { employee: number; employer: number };
interface Annual { actualMonthly: number; bonusEmployer: number; actual: number; confirmedMonths: number; forecast: number; remainingMonths: number }
interface Analysis {
  fiscalYear: number; latestMonth: string | null; previousMonth: string | null;
  monthly: { yearMonth: string; employee: number; employer: number; people: number }[];
  breakdown: { health: Pair; care: Pair; childSupport: Pair; pension: Pair };
  changeFactors: Record<'joined' | 'left' | 'grade' | 'exemption' | 'other', number> | null;
  departments: { name: string; employee: number; employer: number; people: number }[];
  gradeHistogram: { grade: number; count: number }[];
  annual: Annual; previousAnnual: Annual;
}

const KIND_LABELS: [keyof Analysis['breakdown'], string, string][] = [
  ['health', '健康保険', 'var(--app-color-link)'], ['care', '介護保険', 'var(--app-status-attention-fg)'],
  ['childSupport', '子ども・子育て支援金', 'var(--app-status-done-fg)'], ['pension', '厚生年金', 'var(--app-color-text-sub)'],
];
const FACTOR_LABELS: Record<string, string> = { joined: '入社', left: '退職', grade: '等級の変更', exemption: '産休・育休の免除', other: '料率など' };

/** 保険料の分析（カタログ12章）：月次推移・内訳・前月比の要因・部署別・等級分布・年間の実績と見込み・CSV。グラフは自前の SVG */
@Component({
  selector: 'app-cost-analysis',
  standalone: true,
  imports: [DecimalPipe, FormsModule, MatButtonModule],
  template: `
    <div class="bar">
      <label>年度 <select [(ngModel)]="fiscalYear" (change)="load()">@for (y of years; track y) { <option [ngValue]="y">{{ y }}年度（{{ y }}年4月〜{{ y + 1 }}年3月）</option> }</select></label>
      <button mat-stroked-button type="button" (click)="exportCsv()" [disabled]="!a()">CSVで出力</button>
    </div>
    @if (error()) { <p class="error">{{ error() }}</p> }
    @if (loading()) { <p class="sub">確定済みの保険料を集計しています…</p> }
    @if (a(); as a) {
      <section class="card">
        <h3>月ごとの保険料（本人＋会社）</h3>
        <svg [attr.viewBox]="'0 0 600 180'" class="chart" role="img" aria-label="月ごとの保険料の推移">
          @for (p of linePoints(); track p.ym; let i = $index) {
            <rect [attr.x]="p.x - 14" [attr.y]="p.yEmployer" width="28" [attr.height]="p.hEmployer" fill="var(--app-color-link)" opacity="0.85"><title>{{ p.ym }} 会社 {{ p.employer | number }}円</title></rect>
            <rect [attr.x]="p.x - 14" [attr.y]="p.yEmployee" width="28" [attr.height]="p.hEmployee" fill="var(--app-status-done-fg)" opacity="0.6"><title>{{ p.ym }} 本人 {{ p.employee | number }}円</title></rect>
            <text [attr.x]="p.x" y="175" text-anchor="middle" class="axis">{{ p.label }}</text>
          }
        </svg>
        <p class="legend"><span class="sw" style="background: var(--app-color-link)"></span>会社負担 <span class="sw" style="background: var(--app-status-done-fg)"></span>本人負担（確定した月だけ）</p>
      </section>

      <div class="cols">
        <section class="card">
          <h3>保険の種類ごとの内訳（{{ a.latestMonth ?? '—' }}）</h3>
          <div class="stack">@for (k of kinds; track k[0]) { <span [style.flex]="share(a, k[0])" [style.background]="k[2]" [title]="k[1]"></span> }</div>
          <table><tbody>@for (k of kinds; track k[0]) {
            <tr><td><span class="sw" [style.background]="k[2]"></span>{{ k[1] }}</td><td class="num">{{ total(a.breakdown[k[0]]) | number }}円</td><td class="num sub">{{ percent(a, k[0]) }}%</td></tr>
          }</tbody></table>
        </section>
        <section class="card">
          <h3>前月からの増減（{{ a.previousMonth ?? '—' }} → {{ a.latestMonth ?? '—' }}）</h3>
          @if (a.changeFactors; as f) {
            <p class="big">{{ sign(sumFactors(f)) }}{{ sumFactors(f) | number }}円</p>
            <table><tbody>@for (k of factorKeys; track k) { <tr><td>{{ factorLabel(k) }}</td><td class="num">{{ sign(f[k]) }}{{ f[k] | number }}円</td></tr> }</tbody></table>
          } @else { <p class="sub">比べる月がありません。</p> }
        </section>
      </div>

      <div class="cols">
        <section class="card">
          <h3>年間の会社負担（{{ a.fiscalYear }}年度）</h3>
          <table><tbody>
            <tr><td>実績（確定 {{ a.annual.confirmedMonths }}か月＋賞与）</td><td class="num">{{ a.annual.actual | number }}円</td></tr>
            <tr><td>見込み（直近の月が年度末まで続くと仮定）</td><td class="num"><b>{{ a.annual.forecast | number }}円</b></td></tr>
            <tr><td>前年度の実績（確定 {{ a.previousAnnual.confirmedMonths }}か月＋賞与）</td><td class="num">{{ a.previousAnnual.actual | number }}円</td></tr>
            @if (a.previousAnnual.actual > 0) { <tr><td>前年度との差（見込み−前年度実績）</td><td class="num">{{ sign(a.annual.forecast - a.previousAnnual.actual) }}{{ a.annual.forecast - a.previousAnnual.actual | number }}円</td></tr> }
          </tbody></table>
        </section>
        <section class="card">
          <h3>等級の分布（健康保険、{{ a.latestMonth ?? '—' }}）</h3>
          <svg [attr.viewBox]="'0 0 300 140'" class="chart" role="img" aria-label="等級の分布">
            @for (g of histogram(); track g.grade) {
              <rect [attr.x]="g.x" [attr.y]="g.y" [attr.width]="g.w" [attr.height]="g.h" fill="var(--app-color-link)"><title>{{ g.grade }}等級 {{ g.count }}人</title></rect>
            }
          </svg>
          <p class="sub">{{ gradeRange(a) }}</p>
        </section>
      </div>

      <section class="card">
        <h3>部署ごとの保険料（{{ a.latestMonth ?? '—' }}）</h3>
        <table><thead><tr><th>部署</th><th class="num">人数</th><th class="num">本人負担</th><th class="num">会社負担</th></tr></thead><tbody>
          @for (d of a.departments; track d.name) { <tr><td>{{ d.name }}</td><td class="num">{{ d.people }}</td><td class="num">{{ d.employee | number }}</td><td class="num">{{ d.employer | number }}</td></tr> }
          @empty { <tr><td colspan="4" class="sub">確定した保険料がありません。</td></tr> }
        </tbody></table>
      </section>
    }
  `,
  styles: [`
    .bar { display: flex; gap: 16px; align-items: center; margin: 16px 0; flex-wrap: wrap; }
    .bar select { padding: 6px; margin-left: 8px; }
    .card { background: var(--app-color-surface); border: 1px solid var(--app-color-border); border-radius: var(--app-radius); padding: 16px; margin-bottom: 12px; }
    .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    @media (max-width: 900px) { .cols { grid-template-columns: 1fr; } }
    h3 { margin: 0 0 8px; font-size: var(--app-font-md); }
    .chart { width: 100%; height: auto; }
    .axis { font-size: 10px; fill: var(--app-color-text-sub); }
    .legend { font-size: var(--app-font-xs); color: var(--app-color-text-sub); }
    .sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin: 0 4px 0 8px; vertical-align: middle; }
    .stack { display: flex; height: 18px; border-radius: 4px; overflow: hidden; margin-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; font-size: var(--app-font-sm); }
    td, th { padding: 4px 6px; border-bottom: 1px solid var(--app-color-border); text-align: left; }
    .num { text-align: right; }
    .big { font-size: 20px; font-weight: 700; margin: 0 0 6px; }
    .sub { color: var(--app-color-text-sub); font-size: var(--app-font-sm); }
    .error { color: var(--app-status-error-fg); }
  `],
})
export class CostAnalysisComponent {
  private functions = inject(Functions);
  private auth = inject(AuthService);
  private office = inject(OfficeContextService);

  private now = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  fiscalYear = Number(this.now.slice(5, 7)) >= 4 ? Number(this.now.slice(0, 4)) : Number(this.now.slice(0, 4)) - 1;
  years = [this.fiscalYear, this.fiscalYear - 1, this.fiscalYear - 2];
  kinds = KIND_LABELS;
  factorKeys = Object.keys(FACTOR_LABELS) as (keyof NonNullable<Analysis['changeFactors']>)[];
  a = signal<Analysis | null>(null);
  loading = signal(false);
  error = signal('');

  constructor() {
    effect(() => { this.office.selected(); untracked(() => void this.load()); });
  }

  linePoints = computed(() => {
    const m = this.a()?.monthly ?? [];
    const max = Math.max(1, ...m.map(x => x.employee + x.employer));
    return m.map((x, i) => {
      const hEmployer = (x.employer / max) * 150, hEmployee = (x.employee / max) * 150;
      return { ym: x.yearMonth, label: `${Number(x.yearMonth.slice(5))}月`, x: 30 + i * 48, employer: x.employer, employee: x.employee,
        yEmployer: 160 - hEmployer, hEmployer, yEmployee: 160 - hEmployer - hEmployee, hEmployee };
    });
  });

  histogram = computed(() => {
    const h = this.a()?.gradeHistogram ?? [];
    if (!h.length) return [];
    const min = h[0].grade, max = h.at(-1)!.grade, top = Math.max(...h.map(g => g.count));
    const w = 290 / (max - min + 1);
    return h.map(g => ({ ...g, x: 5 + (g.grade - min) * w, w: Math.max(1, w - 2), h: (g.count / top) * 130, y: 135 - (g.count / top) * 130 }));
  });

  total(p: Pair) { return p.employee + p.employer; }
  share(a: Analysis, k: keyof Analysis['breakdown']) { return this.total(a.breakdown[k]); }
  percent(a: Analysis, k: keyof Analysis['breakdown']) {
    const all = KIND_LABELS.reduce((s, x) => s + this.total(a.breakdown[x[0]]), 0);
    return all ? Math.round((this.total(a.breakdown[k]) / all) * 1000) / 10 : 0;
  }
  sumFactors(f: NonNullable<Analysis['changeFactors']>) { return Object.values(f).reduce((s, v) => s + v, 0); }
  sign(n: number) { return n > 0 ? '+' : ''; }
  factorLabel(k: string) { return FACTOR_LABELS[k] ?? k; }
  gradeRange(a: Analysis) {
    const h = a.gradeHistogram;
    if (!h.length) return '確定した保険料がありません。';
    const peak = [...h].sort((x, y) => y.count - x.count)[0];
    return `${h[0].grade}〜${h.at(-1)!.grade}等級。いちばん多いのは${peak.grade}等級（${peak.count}人）`;
  }

  async load() {
    this.loading.set(true);
    this.error.set('');
    try {
      const { data } = await httpsCallable<object, Analysis>(this.functions, 'costAnalysis', { timeout: 120_000 })({
        companyId: this.auth.companyId, fiscalYear: Number(this.fiscalYear), ...this.office.params(),
      });
      this.a.set(data);
    } catch (e: any) {
      this.error.set(`集計できませんでした：${e?.message ?? ''}`);
    } finally {
      this.loading.set(false);
    }
  }

  /** 集計を CSV にして手元に保存する（期間＝年度、事業所＝上で選んだもの） */
  exportCsv() {
    const a = this.a();
    if (!a) return;
    const rows: (string | number)[][] = [['区分', '項目', '本人負担', '会社負担', '人数']];
    for (const m of a.monthly) rows.push(['月別', m.yearMonth, m.employee, m.employer, m.people]);
    for (const [k, label] of KIND_LABELS) rows.push(['内訳', label, a.breakdown[k].employee, a.breakdown[k].employer, '']);
    for (const d of a.departments) rows.push(['部署', d.name, d.employee, d.employer, d.people]);
    for (const g of a.gradeHistogram) rows.push(['等級', `${g.grade}等級`, '', '', g.count]);
    rows.push(['年間', '実績（会社負担）', '', a.annual.actual, ''], ['年間', '見込み（会社負担）', '', a.annual.forecast, ''], ['年間', '前年度実績（会社負担）', '', a.previousAnnual.actual, '']);
    const csv = '﻿' + rows.map(r => r.map(v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v)).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `保険料の分析_${a.fiscalYear}年度.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }
}
