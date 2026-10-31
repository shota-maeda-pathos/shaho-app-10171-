import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../core/services/auth.service';

interface PremiumMonth {
  yearMonth: string; standardRemuneration: number | null; health: number; childSupport: number; longTermCare: number | null;
  pension: number; total: number; isExempted: boolean; changeReason: string | null; change: number | null;
  /** 訂正した月の理由（古いサーバーは返さない） */
  corrected?: string | null;
}

interface PortalDetails {
  profile: Record<string, string | null>;
  grade: { healthGrade: number; healthStandardRemuneration: number; pensionGrade: number; pensionStandardRemuneration: number; effectiveMonth: string } | null;
  insuranceTypes: { health: boolean | null; pension: boolean | null; longTermCare: boolean | null; acquisitionDate: string | null } | null;
  premiums: { months: PremiumMonth[]; annual: { year: string; total: number; months: number }[] } | null;
  gradeChanges: { effectiveMonth: string; reason: string; oldHealthGrade: number; newHealthGrade: number; oldPensionGrade: number; newPensionGrade: number; premiumChange: number | null }[] | null;
  filings: { type: string; requestedAt: string | null; status: string; acceptanceNumber: string | null }[] | null;
  dependents: { name: string; birthDate: string | null; relationship: string; qualificationDate: string | null; status: string }[] | null;
}

const PROFILE_LABELS: [string, string][] = [
  ['birthDate', '生年月日'], ['gender', '性別'], ['address', '住所'], ['employmentType', '雇用区分'], ['hireDate', '入社日'],
  ['officeName', '事業所'], ['departmentName', '部署'], ['healthInsuranceNumber', '健康保険の被保険者番号'], ['insuredPersonNumber', '被保険者整理番号'],
];

/** 本人ポータルの詳しい情報（カタログ11章）。個人番号は表示しない。管理者が非公開にした項目はサーバーが返さない */
@Component({
  selector: 'app-portal-info',
  standalone: true,
  imports: [DatePipe, DecimalPipe],
  template: `
    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
    @if (d(); as d) {
      <section class="card">
        <h2>わたしの情報</h2>
        <dl class="rows">
          @for (row of profileRows(d); track row[0]) { <dt>{{ row[0] }}</dt><dd>{{ row[1] || '—' }}</dd> }
          @if (d.grade; as g) {
            <dt>健康保険の標準報酬月額</dt><dd>{{ g.healthStandardRemuneration | number }}円（{{ g.healthGrade }}等級）</dd>
            <dt>厚生年金の標準報酬月額</dt><dd>{{ g.pensionStandardRemuneration | number }}円（{{ g.pensionGrade }}等級）</dd>
          }
          @if (d.insuranceTypes; as t) {
            <dt>加入している保険</dt><dd>{{ insuranceText(t) }}</dd>
            <dt>資格取得日</dt><dd>{{ t.acquisitionDate ?? '—' }}</dd>
          }
        </dl>
      </section>

      @if (d.gradeChanges?.length) {
        <section class="card">
          <h2>等級が変わりました</h2>
          @for (c of d.gradeChanges!.slice(0, 3); track c.effectiveMonth) {
            <p class="change">{{ c.effectiveMonth }}から（{{ c.reason }}）：健康保険 {{ c.oldHealthGrade }}→{{ c.newHealthGrade }}等級、厚生年金 {{ c.oldPensionGrade }}→{{ c.newPensionGrade }}等級
              @if (c.premiumChange !== null) { 。毎月の保険料は {{ c.premiumChange >= 0 ? '+' : '' }}{{ c.premiumChange | number }}円 }</p>
          }
        </section>
      }

      @if (d.premiums; as p) {
        <section class="card">
          <h2>保険料の明細（本人負担）</h2>
          <div class="annual">@for (y of p.annual; track y.year) { <span>{{ y.year }}年：<b>{{ y.total | number }}円</b>（{{ y.months }}か月）</span> }</div>
          <div class="table-wrap"><table>
            <thead><tr><th>月</th><th>標準報酬月額</th><th>健康保険</th><th>支援金</th><th>介護保険</th><th>厚生年金</th><th>合計</th></tr></thead>
            <tbody>
              @for (m of p.months; track m.yearMonth) {
                <tr [class.changed]="m.changeReason">
                  <td>{{ m.yearMonth }}@if (m.changeReason) { <span class="reason">{{ m.changeReason }}（{{ (m.change ?? 0) >= 0 ? '+' : '' }}{{ m.change | number }}円）</span> }
                    @if (m.corrected) { <span class="reason">訂正済み：{{ m.corrected }}</span> }</td>
                  <td>{{ m.standardRemuneration | number }}</td><td>{{ m.health | number }}</td><td>{{ m.childSupport | number }}</td>
                  <td>{{ m.longTermCare === null ? '—' : (m.longTermCare | number) }}</td><td>{{ m.pension | number }}</td>
                  <td><b>{{ m.total | number }}</b>@if (m.isExempted) { （免除）}</td>
                </tr>
              } @empty { <tr><td colspan="7">確定した保険料はまだありません。</td></tr> }
            </tbody>
          </table></div>
        </section>
      }

      @if (d.filings) {
        <section class="card">
          <h2>届出の処理状況</h2>
          <table><thead><tr><th>届出</th><th>申請日</th><th>状況</th><th>受付番号</th></tr></thead><tbody>
            @for (f of d.filings; track $index) {
              <tr><td>{{ f.type }}</td><td>{{ f.requestedAt | date: 'yyyy/M/d' }}</td><td>{{ f.status }}</td><td>{{ f.acceptanceNumber ?? '—' }}</td></tr>
            } @empty { <tr><td colspan="4">あなたに関する届出はまだありません。</td></tr> }
          </tbody></table>
        </section>
      }

      @if (d.dependents) {
        <section class="card">
          <h2>扶養家族</h2>
          <table><thead><tr><th>氏名</th><th>続柄</th><th>生年月日</th><th>認定日</th><th>状況</th></tr></thead><tbody>
            @for (p of d.dependents; track $index) {
              <tr><td>{{ p.name }}</td><td>{{ p.relationship }}</td><td>{{ p.birthDate ?? '—' }}</td><td>{{ p.qualificationDate ?? '—' }}</td><td>{{ p.status }}</td></tr>
            } @empty { <tr><td colspan="5">扶養家族は登録されていません。</td></tr> }
          </tbody></table>
        </section>
      }
    } @else if (!error()) { <p class="sub">読み込み中…</p> }
  `,
  styles: [`
    .card { background: var(--app-color-surface); border: 1px solid var(--app-color-border); border-radius: var(--app-radius); padding: var(--app-space-4); margin-bottom: var(--app-space-4); }
    h2 { margin: 0 0 var(--app-space-3); font-size: var(--app-font-lg); }
    .rows { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin: 0; font-size: var(--app-font-sm); }
    dt { color: var(--app-color-text-sub); }
    dd { margin: 0; }
    .annual { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: var(--app-space-2); font-size: var(--app-font-sm); }
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: var(--app-font-sm); }
    th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--app-color-border); white-space: nowrap; }
    th { color: var(--app-color-text-sub); font-weight: 600; }
    tr.changed td { background: var(--app-status-attention-bg); }
    .reason { display: block; font-size: var(--app-font-xs); color: var(--app-status-attention-fg); }
    .change { margin: 0 0 6px; font-size: var(--app-font-sm); }
    .error { color: var(--app-status-error-fg); }
    .sub { color: var(--app-color-text-sub); }
    @media (max-width: 720px) { .rows { grid-template-columns: 1fr; } dd { margin-bottom: 6px; } }
  `],
})
export class PortalInfoComponent implements OnInit {
  private functions = inject(Functions);
  private auth = inject(AuthService);
  d = signal<PortalDetails | null>(null);
  error = signal('');

  async ngOnInit() {
    try {
      const { data } = await httpsCallable<object, PortalDetails>(this.functions, 'portalDetails')({ companyId: this.auth.companyId });
      this.d.set(data);
    } catch (e: any) {
      this.error.set(e?.message ?? '情報を読み込めませんでした');
    }
  }

  profileRows(d: PortalDetails): [string, string | null][] {
    return PROFILE_LABELS.filter(([k]) => k in d.profile).map(([k, label]) => [label, d.profile[k]]);
  }

  insuranceText(t: NonNullable<PortalDetails['insuranceTypes']>): string {
    return [t.health ? '健康保険' : null, t.longTermCare ? '介護保険' : null, t.pension ? '厚生年金' : null].filter(Boolean).join('・') || '—';
  }
}
