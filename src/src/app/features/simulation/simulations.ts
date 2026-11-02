import { Component, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../core/services/auth.service';
import { OfficeContextService } from '../../core/services/office-context.service';

import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
type Kind = 'raise' | 'hire' | 'annual' | 'rateChange' | 'bonus';
const FN: Record<Kind, string> = { raise: 'simulationRaise', hire: 'simulationHire', annual: 'simulationAnnual', rateChange: 'simulationRateChange', bonus: 'simulationBonus' };

/** 試算シミュレーション5種（カタログ13章）。実データは書き換えない。結果は CSV で手元に保存する */
@Component({
  selector: 'app-simulations',
  standalone: true,
  imports: [MatDatepickerModule, MatFormFieldModule, MatInputModule, MatSelectModule, DecimalPipe, FormsModule, MatButtonModule],
  template: `
    <div class="kinds">
      @for (k of kinds; track k[0]) { <button type="button" [class.on]="kind === k[0]" (click)="kind = k[0]; result.set(null); error.set('')">{{ k[1] }}</button> }
    </div>
    <p class="sub">試算の結果は保存されません。実際の等級・保険料は変わりません。{{ office.label() }}の従業員が対象です（上の事業所の切り替えで絞れます）。</p>

    <div class="form">
      <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>対象の月</mat-label><input matInput type="month" [(ngModel)]="yearMonth" name="ym"></mat-form-field>
      @switch (kind) {
        @case ('raise') {
          <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>方法</mat-label><mat-select [(ngModel)]="method" name="method"><mat-option value="amount">一律の金額</mat-option><mat-option value="rate">一律の率</mat-option><mat-option value="individual">1人ずつ</mat-option></mat-select></mat-form-field>
          @if (method === 'amount') { <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>昇給額（円）</mat-label><input matInput type="number" [(ngModel)]="amount" name="amount"></mat-form-field> }
          @if (method === 'rate') { <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>昇給率（%）</mat-label><input matInput type="number" step="0.1" [(ngModel)]="rate" name="rate"></mat-form-field> }
          @if (method === 'individual') { <mat-form-field appearance="outline" subscriptSizing="dynamic" class="wide"><mat-label>社員ごとの新しい報酬（1行に「従業員ID,金額」）</mat-label><textarea matInput rows="4" [(ngModel)]="individualText" name="ind"></textarea></mat-form-field> }
        }
        @case ('hire') {
          @if (!officeId()) { <p class="warn">上で事業所を1つ選んでください。</p> }
          <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>想定の報酬月額（円）</mat-label><input matInput type="number" min="0" [(ngModel)]="remuneration" name="rem"></mat-form-field>
          <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>生年月日</mat-label><input matInput [(ngModel)]="birthDate" name="bd" [matDatepicker]="dp1" placeholder="YYYY/MM/DD"><mat-datepicker-toggle matIconSuffix [for]="dp1" /><mat-datepicker #dp1 startView="multi-year" /></mat-form-field>
        }
        @case ('annual') {
          <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>賞与1回の想定額（円）</mat-label><input matInput type="number" min="0" [(ngModel)]="bonusPerPayment" name="bpp"></mat-form-field>
          <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>賞与の回数</mat-label><input matInput type="number" min="0" max="4" [(ngModel)]="bonusTimes" name="bt"></mat-form-field>
        }
        @case ('rateChange') {
          <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>健康保険料率（‰、例 99.1）</mat-label><input matInput type="number" step="0.01" [(ngModel)]="healthRate" name="hr"></mat-form-field>
          <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>介護保険料率（‰）</mat-label><input matInput type="number" step="0.01" [(ngModel)]="careRate" name="cr"></mat-form-field>
          <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>厚生年金保険料率（‰）</mat-label><input matInput type="number" step="0.01" [(ngModel)]="pensionRate" name="pr"></mat-form-field>
        }
        @case ('bonus') {
          @if (!officeId()) { <p class="warn">上で事業所を1つ選んでください。</p> }
          <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>従業員ID（任意。入れると今年度の累計で上限を判定）</mat-label><input matInput [(ngModel)]="employeeId" name="eid"></mat-form-field>
          <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>生年月日（従業員IDがないとき）</mat-label><input matInput [(ngModel)]="birthDate" name="bd2" [matDatepicker]="dp2" placeholder="YYYY/MM/DD"><mat-datepicker-toggle matIconSuffix [for]="dp2" /><mat-datepicker #dp2 startView="multi-year" /></mat-form-field>
          <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>賞与額（円）</mat-label><input matInput type="number" min="0" [(ngModel)]="bonusAmount" name="ba"></mat-form-field>
        }
      }
      <button mat-flat-button color="primary" type="button" (click)="run()" [disabled]="busy()">{{ busy() ? '計算しています…' : '試算する' }}</button>
    </div>
    @if (error()) { <p class="error">{{ error() }}</p> }

    @if (result(); as r) {
      <div class="result">
        @switch (kind) {
          @case ('raise') {
            <p class="big">会社負担 {{ sign(r.company.diffEmployer) }}{{ r.company.diffEmployer | number }}円／月（年 {{ sign(r.company.diffEmployer) }}{{ r.company.diffEmployer * 12 | number }}円）・本人負担 {{ sign(r.company.diffEmployee) }}{{ r.company.diffEmployee | number }}円／月（{{ r.company.people }}人）</p>
            <table><thead><tr><th>氏名</th><th>事業所</th><th class="num">今の報酬</th><th class="num">昇給後</th><th>等級（健保）</th><th class="num">本人の差</th><th class="num">会社の差</th><th class="num">会社の年間</th><th>随時改定</th></tr></thead><tbody>
              @for (x of r.rows; track x.employeeId) {
                <tr><td>{{ x.name }}</td><td>{{ x.officeName }}</td><td class="num">{{ x.currentRemuneration | number }}</td><td class="num">{{ x.newRemuneration | number }}</td>
                  <td>{{ x.before.healthGrade }}→{{ x.after.healthGrade }}</td><td class="num">{{ sign(x.diffEmployee) }}{{ x.diffEmployee | number }}</td><td class="num">{{ sign(x.diffEmployer) }}{{ x.diffEmployer | number }}</td>
                  <td class="num">{{ sign(x.annualDiffEmployer) }}{{ x.annualDiffEmployer | number }}</td><td class="small">{{ x.revision ? '可能性あり' : '' }}</td></tr>
              }
            </tbody></table>
            @if (r.skipped) { <p class="sub">等級が未登録の{{ r.skipped }}人は除きました。</p> }
            <p class="sub">随時改定は等級の差（2等級以上）から見た「可能性」です。固定的賃金の変動・3か月の報酬・支払基礎日数で決まります。</p>
          }
          @case ('hire') {
            <p class="big">{{ r.premium.healthGrade }}等級（健保）・{{ r.premium.pensionGrade ?? '—' }}等級（厚年）：本人 {{ r.premium.employee | number }}円・会社 {{ r.premium.employer | number }}円／月</p>
            <p>年間の会社負担の増加：<b>{{ r.annualEmployerIncrease | number }}円</b></p>
            <p>{{ r.officeName }}の保険料（{{ r.office.people }}人→{{ r.office.people + 1 }}人）：会社 {{ r.office.before.employer | number }}円 → {{ r.office.after.employer | number }}円／月、本人 {{ r.office.before.employee | number }}円 → {{ r.office.after.employee | number }}円／月</p>
          }
          @case ('annual') {
            <p class="big">年間の会社負担 {{ r.total | number }}円（{{ r.people }}人）</p>
            <p>月額保険料 ×12：{{ r.monthlyEmployer | number }}円 ／ 賞与：{{ r.bonusEmployer | number }}円</p>
            @if (r.previousActual !== null) { <p>{{ r.previousFiscalYear }}年度の実績：{{ r.previousActual | number }}円（差 {{ sign(r.total - r.previousActual) }}{{ r.total - r.previousActual | number }}円）</p> }
          }
          @case ('rateChange') {
            <p class="big">会社負担 {{ sign(r.company.diffEmployer) }}{{ r.company.diffEmployer | number }}円／月・本人負担 {{ sign(r.company.diffEmployee) }}{{ r.company.diffEmployee | number }}円／月（{{ r.company.people }}人）</p>
            <table><thead><tr><th>事業所</th><th class="num">人数</th><th class="num">本人の差</th><th class="num">会社の差</th></tr></thead><tbody>
              @for (o of r.offices; track o.officeName) { <tr><td>{{ o.officeName }}</td><td class="num">{{ o.people }}</td><td class="num">{{ o.diffEmployee | number }}</td><td class="num">{{ o.diffEmployer | number }}</td></tr> }
            </tbody></table>
            <table><thead><tr><th>氏名</th><th>事業所</th><th>等級</th><th class="num">今（本人／会社）</th><th class="num">新（本人／会社）</th></tr></thead><tbody>
              @for (x of r.rows; track x.employeeId) { <tr><td>{{ x.name }}</td><td>{{ x.officeName }}</td><td>{{ x.healthGrade }}</td><td class="num">{{ x.before.employee | number }}／{{ x.before.employer | number }}</td><td class="num">{{ x.after.employee | number }}／{{ x.after.employer | number }}</td></tr> }
            </tbody></table>
          }
          @case ('bonus') {
            <p class="big">標準賞与額 {{ r.standard | number }}円：本人 {{ r.premium.employee | number }}円・会社 {{ r.premium.employer | number }}円</p>
            <p>健康保険：今年度の累計 {{ r.priorHealthCumulative | number }}円＋今回 → {{ r.caps.healthCumulative | number }}円（上限 5,730,000円）。保険料の対象 {{ r.caps.healthCapped | number }}円@if (r.uncharged.health > 0) {、<b>{{ r.uncharged.health | number }}円は上限を超えるので保険料がかかりません</b>}</p>
            <p>厚生年金：1回の上限 1,500,000円。保険料の対象 {{ r.caps.pensionCapped | number }}円@if (r.uncharged.pension > 0) {、<b>{{ r.uncharged.pension | number }}円は上限を超えるので保険料がかかりません</b>}</p>
          }
        }
        <button mat-stroked-button type="button" (click)="exportCsv()">CSVで出力</button>
      </div>
    }
  `,
  styles: [`
    .kinds { display: flex; gap: 6px; flex-wrap: wrap; margin: 16px 0 8px; }
    .kinds button { padding: 6px 14px; border: 1px solid var(--app-color-border); border-radius: 999px; background: var(--app-color-surface); cursor: pointer; font: inherit; }
    .kinds button.on { background: var(--app-color-link); color: #fff; border-color: var(--app-color-link); }
    .form { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; margin: 12px 0; }
    .form label { display: flex; flex-direction: column; gap: 4px; font-size: var(--app-font-sm); color: var(--app-color-text-sub); }
    .form input:not(.mat-mdc-input-element), .form textarea:not(.mat-mdc-input-element) { padding: 6px 8px; font: inherit; border: 1px solid var(--app-color-border); border-radius: 6px; }
    .wide { flex: 1 1 100%; }
    .result { background: var(--app-color-surface); border: 1px solid var(--app-color-border); border-radius: var(--app-radius); padding: 16px; }
    .big { font-size: 18px; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; font-size: var(--app-font-sm); margin: 8px 0; }
    td, th { padding: 4px 6px; border-bottom: 1px solid var(--app-color-border); text-align: left; }
    .num { text-align: right; } .small { font-size: var(--app-font-xs); }
    .sub { color: var(--app-color-text-sub); font-size: var(--app-font-sm); }
    .warn { color: var(--app-status-attention-fg); } .error { color: var(--app-status-error-fg); }
  `],
})
export class SimulationsComponent {
  private functions = inject(Functions);
  private auth = inject(AuthService);
  office = inject(OfficeContextService);

  kinds: [Kind, string][] = [['raise', '昇給'], ['hire', '新規採用'], ['annual', '年間コスト'], ['rateChange', '料率改定'], ['bonus', '賞与']];
  kind: Kind = 'raise';
  yearMonth = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }).slice(0, 7);
  method: 'amount' | 'rate' | 'individual' = 'amount';
  amount = 10000; rate = 3; individualText = '';
  remuneration = 300000; birthDate = '1995-04-01';
  bonusPerPayment = 500000; bonusTimes = 2;
  healthRate: number | null = null; careRate: number | null = null; pensionRate: number | null = null;
  employeeId = ''; bonusAmount = 500000;
  busy = signal(false);
  error = signal('');
  result = signal<any>(null);

  officeId() { return this.office.selected() || null; }
  sign(n: number) { return n > 0 ? '+' : ''; }

  private input(): Record<string, unknown> {
    const base = { companyId: this.auth.companyId, yearMonth: this.yearMonth, ...(this.officeId() ? { officeId: this.officeId() } : {}) };
    const num = (v: unknown) => Number(v);
    switch (this.kind) {
      case 'raise': {
        if (this.method === 'individual') {
          const individual = Object.fromEntries(this.individualText.split(/\r?\n/).map(l => l.split(/[,\t]/).map(s => s.trim())).filter(p => p[0] && p[1]).map(([id, v]) => [id, num(v.replace(/,/g, ''))]));
          return { ...base, method: 'individual', individual };
        }
        return { ...base, method: this.method, ...(this.method === 'amount' ? { amount: num(this.amount) } : { rate: num(this.rate) }) };
      }
      case 'hire': return { ...base, monthlyRemuneration: num(this.remuneration), birthDate: this.birthDate };
      case 'annual': return { ...base, bonusPerPayment: num(this.bonusPerPayment), bonusTimes: num(this.bonusTimes) };
      case 'rateChange': return { ...base, ...(this.healthRate !== null && `${this.healthRate}` !== '' ? { health: num(this.healthRate) } : {}), ...(this.careRate !== null && `${this.careRate}` !== '' ? { longTermCare: num(this.careRate) } : {}), ...(this.pensionRate !== null && `${this.pensionRate}` !== '' ? { pension: num(this.pensionRate) } : {}) };
      case 'bonus': return { ...base, amount: num(this.bonusAmount), ...(this.employeeId ? { employeeId: this.employeeId.trim() } : { birthDate: this.birthDate }) };
    }
  }

  async run() {
    if ((this.kind === 'hire' || this.kind === 'bonus') && !this.officeId()) { this.error.set('事業所を1つ選んでください'); return; }
    this.busy.set(true);
    this.error.set('');
    try {
      const { data } = await httpsCallable(this.functions, FN[this.kind], { timeout: 120_000 })(this.input());
      this.result.set(data);
    } catch (e: any) {
      this.error.set(e?.message ?? '試算できませんでした');
    } finally {
      this.busy.set(false);
    }
  }

  exportCsv() {
    const r = this.result();
    if (!r) return;
    let rows: (string | number | null)[][];
    if (this.kind === 'raise') rows = [['氏名', '事業所', '今の報酬', '昇給後', '今の等級', '新しい等級', '本人の差', '会社の差', '会社の年間の差', '随時改定'], ...r.rows.map((x: any) => [x.name, x.officeName, x.currentRemuneration, x.newRemuneration, x.before.healthGrade, x.after.healthGrade, x.diffEmployee, x.diffEmployer, x.annualDiffEmployer, x.revision ? '可能性あり' : ''])];
    else if (this.kind === 'rateChange') rows = [['氏名', '事業所', '等級', '今の本人', '今の会社', '新しい本人', '新しい会社'], ...r.rows.map((x: any) => [x.name, x.officeName, x.healthGrade, x.before.employee, x.before.employer, x.after.employee, x.after.employer])];
    else rows = [['項目', '値'], ...Object.entries(r).filter(([, v]) => typeof v !== 'object' || v === null).map(([k, v]) => [k, v as string | number | null])];
    const csv = '﻿' + rows.map(row => row.map(v => /[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? '')).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `試算_${this.kinds.find(k => k[0] === this.kind)![1]}_${this.yearMonth}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
