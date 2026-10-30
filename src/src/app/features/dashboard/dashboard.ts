import { Component, inject, signal, computed, effect, untracked } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../core/services/auth.service';
import { OfficeContextService } from '../../core/services/office-context.service';
import { StatusBadgeComponent, StatusTone, LoadingStateComponent, EmptyStateComponent, ErrorStateComponent } from '../../shared/ui';
import { LifeEventCardsComponent } from '../procedures/life-events';

/** サーバーの homeTodos が返す1件 */
interface HomeTodo {
  id: string;
  kind: 'onboarding' | 'resignation' | 'dependent' | 'leave' | 'revision' | 'age' | 'procedure' | 'monthly' | 'santei' | 'bonus';
  title: string;
  next: string;
  detail: string | null;
  officeName: string;
  deadline: string | null;
  tone: Exclude<StatusTone, 'done'>;
  route: string;
  queryParams: Record<string, string>;
  updatedAt: string | null;
}

/**
 * ホーム。やることリスト（期限の近い順・「続きから」）と、新しく始める業務のカード。
 * 統計は集計・試算の画面で見る
 */
@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [NgTemplateOutlet, RouterLink, MatButtonModule, MatIconModule, StatusBadgeComponent, LoadingStateComponent, EmptyStateComponent, ErrorStateComponent, LifeEventCardsComponent],
  template: `
    <div class="home">
      <header class="welcome">
        <h1>ホーム</h1>
        <p class="subtitle">{{ greeting() }}、{{ auth.profile()?.displayName ?? 'ユーザー' }}さん</p>
      </header>

      @if (!auth.loading() && !auth.profile()) {
        <p role="alert">ユーザー情報を取得できません。会社への登録とアクセス権を管理者に確認してください。</p>
      }

      @if (canSeeTodos()) {
        <section class="todos" aria-labelledby="todo-heading">
          <div class="section-head">
            <h2 id="todo-heading">やること</h2>
            @if (todos(); as items) {
              <span class="counts">
                @if (count('action')) { <app-status-badge tone="action" [label]="'要対応 ' + count('action') + '件'" /> }
                @if (count('yours')) { <app-status-badge tone="yours" [label]="'あなたの番 ' + count('yours') + '件'" /> }
                @if (count('waiting')) { <app-status-badge tone="waiting" [label]="'他の人の待ち ' + count('waiting') + '件'" /> }
              </span>
            }
            <button mat-button type="button" class="refresh" (click)="load()" [disabled]="loading()"><mat-icon>refresh</mat-icon>最新にする</button>
          </div>
          <p class="caption">期限の近い順です。{{ office.label() }}の分を表示しています。</p>

          @if (loading() && !todos()) { <app-loading-state message="やることを集めています…" /> }
          @if (error()) { <app-error-state heading="やることを読み込めませんでした" [message]="error()" (retry)="load()" /> }

          @if (todos(); as items) {
            @if (mine().length === 0 && waiting().length === 0) {
              <app-empty-state icon="task_alt" message="いまやることはありません" [hint]="isOperator() ? '新しい業務は下のカードから始められます。' : '承認を頼まれると、ここに表示されます。'" />
            }
            @if (mine().length) {
              <ul class="todo-list" aria-label="あなたがやること">
                @for (todo of mine(); track todo.id) { <ng-container *ngTemplateOutlet="row; context: { $implicit: todo }" /> }
              </ul>
            }
            @if (waiting().length) {
              <h3 class="sub-heading">ほかの人を待っているもの</h3>
              <ul class="todo-list" aria-label="ほかの人を待っているもの">
                @for (todo of waiting(); track todo.id) { <ng-container *ngTemplateOutlet="row; context: { $implicit: todo }" /> }
              </ul>
            }
          }
          <p class="links">
            <a routerLink="/procedures" [queryParams]="office.queryParams()">進行中の手続きをすべて見る</a>
            <a routerLink="/approvals" [queryParams]="office.queryParams()">承認の一覧を見る</a>
          </p>
        </section>
      }

      @if (isOperator()) {
        <section class="start" aria-labelledby="start-heading">
          <h2 id="start-heading">新しく始める</h2>
          <p class="caption">何が起きたかを選んでください。</p>
          <app-life-event-cards />
        </section>
      }

      @if (auth.hasRole('viewer') && !canSeeTodos()) {
        <section class="viewer">
          <p>集計・試算の画面で、保険料の推移や内訳を確認できます。</p>
          <a mat-stroked-button routerLink="/analytics" [queryParams]="office.queryParams()">集計・試算を開く</a>
        </section>
      }

      @if (auth.hasRole('employee') && !auth.profile()?.employeeId) { <p role="alert">従業員情報とアカウントが紐付いていません。管理者に確認してください。</p> }
      @if (auth.hasRole('employee') && auth.profile()?.employeeId) {
        <a class="portal-banner" routerLink="/portal">
          <mat-icon aria-hidden="true">account_circle</mat-icon>
          <span><strong>マイポータル</strong><br>給与明細や保険情報を確認できます</span>
          <mat-icon aria-hidden="true" class="chevron">chevron_right</mat-icon>
        </a>
      }
    </div>

    <ng-template #row let-todo>
      <li class="todo" [attr.data-tone]="todo.tone">
        <div class="todo-main">
          <div class="todo-title">
            <app-status-badge [tone]="todo.tone" />
            <strong>{{ todo.title }}</strong>
            @if (todo.officeName && showOffice()) { <span class="office">{{ todo.officeName }}</span> }
          </div>
          <p class="next">{{ todo.next }}</p>
          @if (todo.detail) { <p class="detail">{{ todo.detail }}</p> }
        </div>
        <div class="todo-deadline" [class.overdue]="overdue(todo)" [class.soon]="soon(todo)">
          @if (todo.deadline) {
            <span class="deadline-label">{{ overdue(todo) ? '期限切れ' : '期限' }}</span>
            <span>{{ dateLabel(todo.deadline) }}</span>
            <span class="days">{{ daysLabel(todo.deadline) }}</span>
          } @else { <span class="deadline-label">期限なし</span> }
        </div>
        <button mat-flat-button type="button" class="continue" [class.secondary]="todo.tone === 'waiting'" (click)="open(todo)">{{ todo.tone === 'waiting' ? '状況を見る' : '続きから' }}</button>
      </li>
    </ng-template>
  `,
  styles: [`
    .home { max-width: 1080px; margin: 0 auto; padding: var(--app-space-5); }
    .welcome { margin-bottom: var(--app-space-5); }
    .welcome h1 { margin: 0; font-size: 28px; font-weight: 500; }
    .subtitle { margin: var(--app-space-1) 0 0; color: var(--app-color-text-sub); font-size: var(--app-font-md); }
    section { margin-bottom: var(--app-space-6); }
    h2 { margin: 0; font-size: var(--app-font-xl); font-weight: 600; }
    .section-head { display: flex; align-items: center; gap: var(--app-space-3); flex-wrap: wrap; }
    .counts { display: flex; gap: var(--app-space-2); flex-wrap: wrap; }
    .refresh { margin-left: auto; }
    .caption { margin: var(--app-space-2) 0 var(--app-space-4); color: var(--app-color-text-sub); font-size: var(--app-font-sm); }
    .sub-heading { margin: var(--app-space-5) 0 var(--app-space-3); font-size: var(--app-font-md); font-weight: 600; color: var(--app-color-text-sub); }
    .todo-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--app-space-2); }
    .todo {
      display: grid; grid-template-columns: 1fr 150px auto; gap: var(--app-space-4); align-items: center;
      padding: var(--app-space-4); background: var(--app-color-surface); border: 1px solid var(--app-color-border);
      border-left: 4px solid var(--app-status-yours-fg); border-radius: var(--app-radius);
    }
    .todo[data-tone="action"] { border-left-color: var(--app-status-action-fg); }
    .todo[data-tone="waiting"] { border-left-color: var(--app-color-border); background: var(--app-color-surface-sub); }
    .todo-title { display: flex; align-items: center; gap: var(--app-space-2); flex-wrap: wrap; }
    .todo-title strong { font-size: var(--app-font-lg); }
    .office { font-size: var(--app-font-sm); color: var(--app-color-text-sub); }
    .next { margin: var(--app-space-2) 0 0; font-size: var(--app-font-md); }
    .detail { margin: var(--app-space-1) 0 0; font-size: var(--app-font-sm); color: var(--app-color-text-sub); }
    .todo-deadline { display: flex; flex-direction: column; font-size: var(--app-font-md); font-variant-numeric: tabular-nums; }
    .deadline-label { font-size: var(--app-font-xs); color: var(--app-color-text-sub); }
    .days { font-size: var(--app-font-xs); color: var(--app-color-text-sub); }
    .todo-deadline.soon, .todo-deadline.soon .days { color: var(--app-status-yours-fg); font-weight: 600; }
    .todo-deadline.overdue, .todo-deadline.overdue .days, .todo-deadline.overdue .deadline-label { color: var(--app-status-action-fg); font-weight: 600; }
    .continue { min-width: 112px; }
    .continue.secondary { background: transparent; color: var(--app-color-link); border: 1px solid var(--app-color-border); }
    .links { display: flex; gap: var(--app-space-5); flex-wrap: wrap; margin-top: var(--app-space-4); font-size: var(--app-font-md); }
    .links a { color: var(--app-color-link); }
    .portal-banner { display: flex; align-items: center; gap: var(--app-space-4); padding: var(--app-space-5); background: var(--app-color-surface); border: 1px solid var(--app-color-border); border-radius: var(--app-radius); color: inherit; text-decoration: none; }
    .portal-banner mat-icon:first-child { font-size: 40px; width: 40px; height: 40px; color: var(--app-color-link); }
    .portal-banner .chevron { margin-left: auto; color: var(--app-color-text-sub); }
    @media (max-width: 720px) {
      .todo { grid-template-columns: 1fr; }
      .todo-deadline { flex-direction: row; gap: var(--app-space-2); align-items: baseline; }
    }
  `],
})
export class DashboardComponent {
  office = inject(OfficeContextService);
  auth = inject(AuthService);
  private router = inject(Router);
  private functions = inject(Functions);

  todos = signal<HomeTodo[] | null>(null);
  /** サーバーの今日（東京）。期限の残り日数に使う */
  today = signal(new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }));
  loading = signal(false);
  error = signal('');
  private sequence = 0;

  mine = computed(() => (this.todos() ?? []).filter(t => t.tone !== 'waiting'));
  waiting = computed(() => (this.todos() ?? []).filter(t => t.tone === 'waiting'));
  /** 事業所を1つに絞っていなければ、各行に事業所名を出す */
  showOffice = computed(() => !this.office.selected() && this.office.offices().length > 1);

  constructor() {
    // ログインした・事業所を切り替えたら読み込み直す
    effect(() => {
      const profile = this.auth.profile();
      this.office.selected();
      if (!this.auth.loading() && profile && this.canSeeTodos()) untracked(() => void this.load());
    });
  }

  canSeeTodos() { return this.auth.hasAnyRole('admin', 'operator', 'approver'); }
  isOperator() { return this.auth.hasAnyRole('admin', 'operator'); }
  count(tone: HomeTodo['tone']) { return (this.todos() ?? []).filter(t => t.tone === tone).length; }

  greeting(): string {
    const h = new Date().getHours();
    if (h < 12) return 'おはようございます';
    if (h < 18) return 'こんにちは';
    return 'お疲れさまです';
  }

  async load() {
    const sequence = ++this.sequence;
    this.loading.set(true);
    this.error.set('');
    try {
      const { data } = await httpsCallable<object, { today: string; items: HomeTodo[] }>(this.functions, 'homeTodos', { timeout: 60_000 })({
        companyId: this.auth.companyId, ...this.office.params(),
      });
      if (sequence !== this.sequence) return;
      this.today.set(data.today);
      this.todos.set(data.items);
    } catch (e: any) {
      if (sequence === this.sequence) this.error.set(e.message === 'INTERNAL' || !e.message ? '少し待ってから、もう一度試してください。' : e.message);
    } finally {
      if (sequence === this.sequence) this.loading.set(false);
    }
  }

  open(todo: HomeTodo) { void this.router.navigate([todo.route], { queryParams: todo.queryParams }); }

  private days(deadline: string) {
    return Math.round((Date.parse(deadline) - Date.parse(this.today())) / 86_400_000);
  }
  overdue(todo: HomeTodo) { return !!todo.deadline && this.days(todo.deadline) < 0; }
  /** 期限まで7日以内 */
  soon(todo: HomeTodo) { return !!todo.deadline && this.days(todo.deadline) >= 0 && this.days(todo.deadline) <= 7; }
  dateLabel(d: string) { const [y, m, day] = d.split('-'); return `${y}年${Number(m)}月${Number(day)}日`; }
  daysLabel(d: string) {
    const n = this.days(d);
    return n < 0 ? `${-n}日過ぎています` : n === 0 ? '今日まで' : `あと${n}日`;
  }
}
