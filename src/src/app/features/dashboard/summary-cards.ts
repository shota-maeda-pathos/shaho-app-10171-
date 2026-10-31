import { Component, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../core/services/auth.service';
import { OfficeContextService } from '../../core/services/office-context.service';

interface SummaryCard { key: string; label: string; link: string; urgent: boolean; count: number }

/**
 * 業務の状況のカード（カタログ12章の10種＋本人からの申請）。数字は毎朝6時と「数え直す」で集計して保存したもの。
 * 押すとその一覧へ移る
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
      <div class="grid">
        @for (c of cards(); track c.key) {
          <button type="button" class="tile" [class.urgent]="c.urgent && c.count > 0" [class.zero]="c.count === 0" (click)="open(c)">
            <span class="n">{{ c.count }}</span><span class="l">{{ c.label }}</span>
          </button>
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
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: var(--app-space-2); }
    .tile { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: var(--app-space-3); text-align: left; cursor: pointer;
      background: var(--app-color-surface); border: 1px solid var(--app-color-border); border-radius: var(--app-radius); font: inherit; color: inherit; }
    .tile:hover { border-color: var(--app-color-link); }
    .n { font-size: 22px; font-weight: 700; }
    .l { font-size: var(--app-font-sm); color: var(--app-color-text-sub); line-height: 1.4; }
    .tile.urgent { background: var(--app-status-error-bg); border-color: var(--app-status-error-fg); }
    .tile.urgent .n, .tile.urgent .l { color: var(--app-status-error-fg); }
    .tile.zero .n { color: var(--app-color-text-sub); }
  `],
})
export class SummaryCardsComponent {
  private functions = inject(Functions);
  private auth = inject(AuthService);
  private office = inject(OfficeContextService);
  private router = inject(Router);

  cards = signal<SummaryCard[]>([]);
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
