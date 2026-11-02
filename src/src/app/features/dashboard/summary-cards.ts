import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../core/services/auth.service';
import { OfficeContextService } from '../../core/services/office-context.service';

interface SummaryCard { key: string; label: string; link: string; urgent: boolean; count: number }

/** まとまりと、まとまりの中での短い名前（元の名前は title に出す） */
const GROUPS: { label: string; cards: [key: string, short: string][] }[] = [
  { label: '届出の期限', cards: [['overdueFilings', '期限切れ'], ['dueThisWeek', '今週が期限']] },
  { label: '止まっている手続き', cards: [['pendingApprovals', '承認待ち'], ['rejectedOrReturned', '差戻し・返戻'], ['portalRequests', '本人からの申請']] },
  { label: '今月の処理', cards: [['missingSalaries', '給与が未登録の従業員'], ['unconfirmedOffices', '保険料が未確定の事業所']] },
  { label: 'これから起きること', cards: [['revisionCandidates', '随時改定の候補'], ['ageEvents', '来月の年齢到達'], ['contractsEnding', '30日以内の契約満了'], ['leavesSoon', '30日以内の産休・育休']] },
];

/**
 * 業務の状況のカード（カタログ12章の10種＋本人からの申請）。数字は毎朝6時と「数え直す」で集計して保存したもの。
 * 期限・止まっている手続き・今月の処理・これから起きることの4つに分けて並べる。押すとその一覧へ移る
 */
@Component({
  selector: 'app-summary-cards',
  standalone: true,
  imports: [DatePipe, MatButtonModule, MatIconModule],
  template: `
    <section class="summary" aria-labelledby="summary-heading">
      <div class="head">
        <h2 id="summary-heading">全体の状況</h2>
        @if (computedAt()) { <span class="sub">{{ computedAt() | date: 'M/d H:mm' }} 時点</span> } @else if (!loading()) { <span class="sub">まだ集計していません</span> }
        @if (canRefresh) { <button mat-button type="button" (click)="refresh()" [disabled]="loading()"><mat-icon>refresh</mat-icon>{{ loading() ? '数えています…' : '数え直す' }}</button> }
      </div>
      <div class="groups">
        @for (g of groups(); track g.label) {
          <div class="group">
            <h3>{{ g.label }}</h3>
            @for (c of g.cards; track c.key) {
              <button type="button" class="row" [class.urgent]="c.urgent && c.count > 0" [class.zero]="c.count === 0" [title]="c.label" (click)="open(c)">
                <span class="l">{{ c.short }}</span><span class="n">{{ c.count }}</span>
              </button>
            }
          </div>
        }
      </div>
    </section>
  `,
  styles: [`
    .summary { margin: var(--app-space-4) 0; }
    .head { display: flex; align-items: center; gap: var(--app-space-2); margin-bottom: var(--app-space-2); }
    h2 { margin: 0; font-size: var(--app-font-lg); }
    .sub { color: var(--app-color-text-sub); font-size: var(--app-font-sm); }
    .head button { margin-left: auto; }
    /* 11種の数字を4つのまとまりに分けて1枚に並べる。0件は薄く */
    .groups { display: grid; grid-template-columns: repeat(4, 1fr); background: var(--app-color-surface); border: 1px solid var(--app-color-border); border-radius: var(--app-radius); box-shadow: var(--app-shadow); }
    @media (max-width: 1000px) { .groups { grid-template-columns: repeat(2, 1fr); } }
    @media (max-width: 560px) { .groups { grid-template-columns: 1fr; } }
    .group { padding: var(--app-space-3) var(--app-space-2) var(--app-space-2); min-width: 0; }
    .group + .group { border-left: 1px solid var(--app-color-border-sub); }
    h3 { margin: 0 var(--app-space-2) var(--app-space-1); font-size: 11px; font-weight: 700; letter-spacing: .05em; color: var(--app-color-muted); }
    .row { display: flex; align-items: baseline; gap: var(--app-space-2); width: 100%; padding: 6px var(--app-space-2); border: 0; border-radius: 6px; background: none; font: inherit; color: inherit; text-align: left; cursor: pointer; }
    .row:hover { background: var(--app-color-bg); }
    .l { flex: 1; min-width: 0; font-size: var(--app-font-sm); color: var(--app-color-text-sub); line-height: 1.4; }
    .n { font-size: 18px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .row.zero .n, .row.zero .l { color: var(--app-color-muted); font-weight: 400; }
    .row.urgent .n, .row.urgent .l { color: var(--app-status-error-fg); font-weight: 700; }
  `],
})
export class SummaryCardsComponent {
  private functions = inject(Functions);
  private auth = inject(AuthService);
  private office = inject(OfficeContextService);
  private router = inject(Router);

  cards = signal<SummaryCard[]>([]);
  groups = computed(() => {
    const byKey = new Map(this.cards().map(c => [c.key, c]));
    return GROUPS.map(g => ({
      label: g.label,
      cards: g.cards.flatMap(([key, short]) => { const c = byKey.get(key); return c ? [{ ...c, short }] : []; }),
    })).filter(g => g.cards.length > 0);
  });
  computedAt = signal<string | null>(null);
  loading = signal(false);
  canRefresh = this.auth.hasAnyRole('admin', 'operator');

  constructor() {
    effect(() => {
      this.office.selected();
      untracked(() => void this.call('dashboardSummary'));
    });
  }

  refresh() { void this.call('dashboardSummaryRefresh'); }

  private async call(name: string) {
    this.loading.set(true);
    try {
      const { data } = await httpsCallable<object, { computedAt: string | null; cards: SummaryCard[] }>(this.functions, name, { timeout: 300_000 })({
        companyId: this.auth.companyId, ...this.office.params(),
      });
      this.cards.set(data.cards);
      this.computedAt.set(data.computedAt);
    } catch { /* カードが読めなくても、やることリストは使える */ } finally {
      this.loading.set(false);
    }
  }

  open(c: SummaryCard) {
    const [path, query] = c.link.split('?');
    const queryParams = Object.fromEntries(new URLSearchParams(query ?? ''));
    void this.router.navigate([path], { queryParams: { ...queryParams, ...this.office.queryParams() } });
  }
}
