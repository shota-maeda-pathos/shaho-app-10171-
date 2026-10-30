import { Component, inject, input, output } from '@angular/core';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { OfficeContextService } from '../../core/services/office-context.service';

/**
 * ライフイベントのカード。「何が起きたか」から業務を選ぶ。
 * route がある業務はその画面へ、ない業務（従業員を選ぶもの）は「手続きを始める」で従業員を選んでから進む
 */
export interface LifeEvent {
  /** 手続きの種類（procedure-start の type） */
  type: string;
  icon: string;
  label: string;
  hint: string;
  route?: string;
}

export const LIFE_EVENT_GROUPS: { label: string; events: LifeEvent[] }[] = [
  {
    label: '入社・退職',
    events: [
      { type: 'acquisition', icon: 'person_add', label: '人が入社する', hint: '本人の入力から資格取得届の提出まで', route: '/onboarding/new' },
      { type: 'loss', icon: 'person_remove', label: '人が退職する', hint: '退職日の登録、資格喪失届、最後の保険料' },
    ],
  },
  {
    label: '在籍中の変化',
    events: [
      { type: 'dependent_change', icon: 'family_restroom', label: '家族が増えた・減った', hint: '被扶養者（異動）届' },
      { type: 'leave', icon: 'child_friendly', label: '産休・育休に入る／戻る', hint: '申出書・保険料の免除・変更届・終了届' },
      { type: 'monthly_change', icon: 'swap_vert', label: '給料が大きく変わった', hint: '随時改定（月額変更届）' },
      { type: 'transfer', icon: 'apartment', label: '別の事業所へ異動する', hint: '事業所間の異動' },
    ],
  },
  {
    label: '毎月・毎年の処理',
    events: [
      { type: 'monthly', icon: 'event_repeat', label: '毎月の保険料処理', hint: '給与の取り込みから明細の公開・徴収まで', route: '/monthly' },
      { type: 'bonus_payment', icon: 'card_giftcard', label: '賞与を払った', hint: '賞与の保険料と賞与支払届', route: '/bonus' },
      { type: 'annual_review', icon: 'assessment', label: '年1回の算定基礎届（7月）', hint: '4〜6月の給与から標準報酬月額を決め直す', route: '/santei' },
    ],
  },
];

export const LIFE_EVENTS = LIFE_EVENT_GROUPS.flatMap(g => g.events);

@Component({
  selector: 'app-life-event-cards',
  standalone: true,
  imports: [MatIconModule],
  template: `
    @for (group of groups; track group.label) {
      <section class="group" [attr.aria-label]="group.label">
        <h3>{{ group.label }}</h3>
        <div class="cards">
          @for (event of group.events; track event.type) {
            <button type="button" class="card" [class.selected]="selected() === event.type" [attr.aria-pressed]="selected() === event.type" (click)="open(event)">
              <mat-icon aria-hidden="true">{{ event.icon }}</mat-icon>
              <span class="label">{{ event.label }}</span>
              <span class="hint">{{ event.hint }}</span>
            </button>
          }
        </div>
      </section>
    }
  `,
  styles: [`
    .group { margin-bottom: var(--app-space-5); }
    h3 { margin: 0 0 var(--app-space-3); font-size: var(--app-font-md); font-weight: 600; color: var(--app-color-text-sub); }
    .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: var(--app-space-3); }
    .card {
      display: grid; grid-template-columns: 32px 1fr; grid-template-rows: auto auto; column-gap: var(--app-space-3); row-gap: var(--app-space-1);
      align-items: center; text-align: left; padding: var(--app-space-4); border: 1px solid var(--app-color-border); border-radius: var(--app-radius);
      background: var(--app-color-surface); color: var(--app-color-text); font: inherit; cursor: pointer;
    }
    .card:hover { border-color: var(--app-color-link); background: var(--app-status-yours-bg); }
    .card:focus-visible { outline: 2px solid var(--app-color-link); outline-offset: 2px; }
    .card.selected { border: 2px solid var(--app-color-link); background: var(--app-status-yours-bg); }
    .card mat-icon { grid-row: 1 / span 2; color: var(--app-color-link); font-size: 28px; width: 28px; height: 28px; }
    .label { font-size: var(--app-font-lg); font-weight: 600; }
    .hint { font-size: var(--app-font-sm); color: var(--app-color-text-sub); }
  `],
})
export class LifeEventCardsComponent {
  private router = inject(Router);
  private office = inject(OfficeContextService);
  groups = LIFE_EVENT_GROUPS;
  /** 選んでいる業務（手続きを始める画面で、従業員を選んでいる間） */
  selected = input<string>('');
  /** 従業員を選ぶ業務を選んだとき。受け取らない画面では「手続きを始める」へ移動する */
  pick = output<LifeEvent>();
  /** pick を受け取る画面か */
  handlesPick = input(false);

  open(event: LifeEvent) {
    if (event.route) { void this.router.navigate([event.route], { queryParams: this.office.queryParams() }); return; }
    if (this.handlesPick()) { this.pick.emit(event); return; }
    void this.router.navigate(['/procedures/new'], { queryParams: { ...this.office.queryParams(), type: event.type } });
  }
}
