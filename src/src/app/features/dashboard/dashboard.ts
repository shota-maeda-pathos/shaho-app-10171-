import { Component, inject, signal, computed, effect, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../core/services/auth.service';
import { ApprovalBadgeService } from '../../core/services/approval-badge.service';
import { OfficeContextService } from '../../core/services/office-context.service';
import { StatusBadgeComponent, StatusTone, LoadingStateComponent, EmptyStateComponent, ErrorStateComponent, PageHeadComponent } from '../../shared/ui';
import { LifeEventCardsComponent } from '../procedures/life-events';

/** サーバーの homeTodos・homeBulkTodo が返す1件 */
interface HomeTodo {
  id: string;
  kind: 'onboarding' | 'resignation' | 'dependent' | 'leave' | 'revision' | 'age' | 'contract' | 'employment' | 'transfer' | 'procedure' | 'monthly' | 'santei' | 'bonus';
  title: string;
  next: string;
  detail: string | null;
  officeName: string;
  deadline: string | null;
  /** サーバーの action は旧い「要対応」（エラー・止まった処理など）。画面では要確認として出す */
  tone: 'action' | 'yours' | 'waiting';
  route: string;
  queryParams: Record<string, string>;
  updatedAt: string | null;
}

/** 毎月の処理・算定・賞与のうち、ホームが1件ずつ読むもの（functions/src/home/service.ts の BulkTarget） */
interface BulkTarget { kind: 'monthly' | 'santei' | 'bonus'; officeId: string; period: string; officeName: string }

type Group = { key: string; label: string; items: HomeTodo[] };

/**
 * ホーム（docs/ui-unification-design.md の5章）。自分が動くものだけを期限の近い順に出す。待ちも含めた全件は手続き一覧で見る。
 * 進行中の手続きは homeTodos で先に出し、毎月の処理・算定・賞与は事業所×月ごとに homeBulkTodo を同時に呼んで、届いたものから足す
 * （1回で全部を計算すると20秒かかるため）。
 */
@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatIconModule, MatProgressSpinnerModule, StatusBadgeComponent, LoadingStateComponent, EmptyStateComponent, ErrorStateComponent, LifeEventCardsComponent, PageHeadComponent],
  template: `
    <div class="app-page">
      <app-page-head [heading]="greeting() + '、' + (auth.profile()?.displayName ?? 'ユーザー') + 'さん'" [kicker]="todayLabel() + '・' + office.label()">
        @if (isOperator()) {
          <ng-container actions>
            <a mat-stroked-button routerLink="/procedures/new"><mat-icon>add</mat-icon>手続きを始める</a>
          </ng-container>
        }
      </app-page-head>

      @if (!auth.loading() && !auth.profile()) {
        <p role="alert">ユーザー情報を取得できません。会社への登録とアクセス権を管理者に確認してください。</p>
      }

      @if (canSeeTodos()) {
        <!-- 数字は1列だけ。押すとその一覧へ -->
        <nav class="stats" aria-label="件数">
          <a routerLink="/procedures" [queryParams]="office.queryParams()"><span class="n">{{ mine().length }}<small>件</small></span><span class="l">あなたの対応</span></a>
          <a routerLink="/approvals" [queryParams]="office.queryParams()"><span class="n">{{ approvalBadge.count() }}<small>件</small></span><span class="l">あなたの承認待ち</span></a>
          <a routerLink="/filings" [class.warn]="dueSoon() > 0"><span class="n">{{ dueSoon() }}<small>件</small></span><span class="l">期限切れ・7日以内</span></a>
          <a routerLink="/procedures" [queryParams]="office.queryParams()"><span class="n">{{ waiting().length }}<small>件</small></span><span class="l">ほかの人の作業待ち</span></a>
        </nav>

        <section class="card" aria-labelledby="todo-heading">
          <div class="card-head">
            <h2 id="todo-heading">やること</h2>
            @if (bulkPending()) {
              <span class="pending"><mat-spinner diameter="14"></mat-spinner>毎月の処理・賞与・算定を確かめています（残り {{ bulkPending() }}件）</span>
            }
            <button mat-button type="button" class="refresh" (click)="load()" [disabled]="loading()"><mat-icon>refresh</mat-icon>最新にする</button>
          </div>

          @if (loading() && !todos()) { <app-loading-state message="やることを集めています…" /> }
          @if (error()) { <app-error-state heading="やることを読み込めませんでした" [message]="error()" (retry)="load()" /> }

          @if (todos()) {
            @if (!mine().length && !bulkPending()) {
              <app-empty-state icon="task_alt" message="いまやることはありません" [hint]="isOperator() ? '新しい業務は下の「新しく始める」から始めます。' : '承認を頼まれると、ここに表示されます。'" />
            }
            @for (g of groups(); track g.key) {
              <div class="group">{{ g.label }}</div>
              @for (todo of g.items; track todo.id) {
                <div class="todo">
                  <span class="due" [class.over]="overdue(todo)" [class.soon]="soon(todo)">
                    @if (todo.deadline) { {{ shortDate(todo.deadline) }}<small>{{ daysLabel(todo.deadline) }}</small> } @else { — }
                  </span>
                  <div class="title">
                    <b>{{ todo.next }}</b>
                    <div class="sub">{{ todo.title }}@if (todo.officeName && showOffice()) {・{{ todo.officeName }}}@if (todo.detail) { ／ {{ todo.detail }}}</div>
                  </div>
                  <app-status-badge [tone]="toneOf(todo)" [label]="toneOf(todo) === 'attention' ? '要確認' : 'あなたの番'" />
                  <button mat-stroked-button type="button" (click)="open(todo)">開く</button>
                </div>
              }
            }
          }
          <div class="card-foot">
            <a routerLink="/procedures" [queryParams]="office.queryParams()">待ちも含めて、進行中の手続きをすべて見る</a>
          </div>
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
  `,
  styles: [`
    .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--app-space-3); margin-bottom: var(--app-space-4); }
    @media (max-width: 720px) { .stats { grid-template-columns: repeat(2, 1fr); } }
    .stats a {
      display: flex; flex-direction: column; gap: 2px; padding: var(--app-space-3) var(--app-space-4); text-decoration: none; color: inherit;
      background: var(--app-color-surface); border: 1px solid var(--app-color-border); border-radius: var(--app-radius);
    }
    .stats a:hover { background: var(--app-color-surface-sub); }
    .stats .n { font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .stats .n small { font-size: var(--app-font-sm); font-weight: 500; margin-left: 2px; color: var(--app-color-text-sub); }
    .stats .l { font-size: var(--app-font-sm); color: var(--app-color-text-sub); }
    .stats a.warn .n { color: var(--app-status-attention-fg); }

    .card { background: var(--app-color-surface); border: 1px solid var(--app-color-border); border-radius: var(--app-radius); margin-bottom: var(--app-space-6); }
    .card-head { display: flex; align-items: center; gap: var(--app-space-3); flex-wrap: wrap; padding: var(--app-space-3) var(--app-space-5); border-bottom: 1px solid var(--app-color-border); }
    .card-head h2 { margin: 0; font-size: var(--app-font-lg); font-weight: 600; }
    .pending { display: inline-flex; align-items: center; gap: var(--app-space-2); font-size: var(--app-font-sm); color: var(--app-color-text-sub); }
    .refresh { margin-left: auto; }
    .group { padding: var(--app-space-2) var(--app-space-5); font-size: var(--app-font-xs); font-weight: 700; color: var(--app-color-text-sub); background: var(--app-color-surface-sub); border-bottom: 1px solid var(--app-color-border); }
    .todo {
      display: grid; grid-template-columns: 96px 1fr auto auto; gap: var(--app-space-4); align-items: center;
      padding: var(--app-space-3) var(--app-space-5); border-bottom: 1px solid var(--app-color-border);
    }
    @media (max-width: 720px) { .todo { grid-template-columns: 1fr; gap: var(--app-space-2); } }
    .due { display: flex; flex-direction: column; font-size: var(--app-font-sm); font-variant-numeric: tabular-nums; }
    .due small { font-size: 11px; color: var(--app-color-text-sub); }
    .due.soon, .due.soon small { color: var(--app-status-attention-fg); font-weight: 700; }
    .due.over, .due.over small { color: var(--app-status-error-fg); font-weight: 700; }
    .title b { font-weight: 600; }
    .sub { margin-top: 2px; font-size: var(--app-font-xs); color: var(--app-color-text-sub); }
    .card-foot { padding: var(--app-space-3) var(--app-space-5); font-size: var(--app-font-sm); }
    .card-foot a { color: var(--app-color-link); }
    .start h2 { margin: 0; font-size: var(--app-font-lg); font-weight: 600; }
    .caption { margin: var(--app-space-1) 0 var(--app-space-3); color: var(--app-color-text-sub); font-size: var(--app-font-sm); }
    .portal-banner { display: flex; align-items: center; gap: var(--app-space-4); padding: var(--app-space-5); background: var(--app-color-surface); border: 1px solid var(--app-color-border); border-radius: var(--app-radius); color: inherit; text-decoration: none; }
    .portal-banner mat-icon:first-child { font-size: 40px; width: 40px; height: 40px; color: var(--app-color-link); }
    .portal-banner .chevron { margin-left: auto; color: var(--app-color-text-sub); }
  `],
})
export class DashboardComponent {
  office = inject(OfficeContextService);
  auth = inject(AuthService);
  approvalBadge = inject(ApprovalBadgeService);
  private router = inject(Router);
  private functions = inject(Functions);

  todos = signal<HomeTodo[] | null>(null);
  /** サーバーの今日（東京）。期限の残り日数に使う */
  today = signal(new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }));
  loading = signal(false);
  error = signal('');
  /** まだ届いていない毎月の処理・算定・賞与の件数 */
  bulkPending = signal(0);
  private sequence = 0;

  mine = computed(() => (this.todos() ?? []).filter(t => t.tone !== 'waiting'));
  waiting = computed(() => (this.todos() ?? []).filter(t => t.tone === 'waiting'));
  dueSoon = computed(() => this.mine().filter(t => t.deadline && this.days(t.deadline) <= 7).length);
  /** 期限で分ける：期限切れ・今日／今週（7日以内）／それ以降／期限なし。中は期限の近い順 */
  groups = computed<Group[]>(() => {
    const sorted = [...this.mine()].sort((a, b) => (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999'));
    const groups: Group[] = [
      { key: 'over', label: '期限切れ・今日', items: sorted.filter(t => t.deadline && this.days(t.deadline) <= 0) },
      { key: 'week', label: '7日以内', items: sorted.filter(t => t.deadline && this.days(t.deadline) > 0 && this.days(t.deadline) <= 7) },
      { key: 'later', label: 'それ以降', items: sorted.filter(t => t.deadline && this.days(t.deadline) > 7) },
      { key: 'none', label: '期限なし', items: sorted.filter(t => !t.deadline) },
    ];
    return groups.filter(g => g.items.length);
  });
  /** 事業所を1つに絞っていなければ、各行に事業所名を出す */
  showOffice = computed(() => !this.office.selected() && this.office.offices().length > 1);
  todayLabel = computed(() => {
    const d = new Date(`${this.today()}T00:00:00+09:00`);
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${'日月火水木金土'[d.getDay()]}）`;
  });

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
  toneOf(todo: HomeTodo): StatusTone { return todo.tone === 'action' ? 'attention' : todo.tone; }

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
      const { data } = await httpsCallable<object, { today: string; items: HomeTodo[]; bulk: BulkTarget[] }>(this.functions, 'homeTodos', { timeout: 60_000 })({
        companyId: this.auth.companyId, ...this.office.params(), deferBulk: true,
      });
      if (sequence !== this.sequence) return;
      this.today.set(data.today);
      this.todos.set(data.items);
      this.loadBulk(sequence, data.bulk ?? []);
    } catch (e: any) {
      if (sequence === this.sequence) this.error.set(e.message === 'INTERNAL' || !e.message ? '少し待ってから、もう一度試してください。' : e.message);
    } finally {
      if (sequence === this.sequence) this.loading.set(false);
    }
  }

  /** 毎月の処理・算定・賞与を1件ずつ同時に読み、届いたものからやることに足す。読めなかったものは要確認の行にする */
  private loadBulk(sequence: number, targets: BulkTarget[]) {
    this.bulkPending.set(targets.length);
    for (const t of targets) {
      httpsCallable<object, { item: HomeTodo | null }>(this.functions, 'homeBulkTodo', { timeout: 60_000 })({
        companyId: this.auth.companyId, kind: t.kind, officeId: t.officeId, period: t.period,
      }).then(({ data }) => {
        if (sequence === this.sequence && data.item) this.todos.update(list => [...(list ?? []), data.item!]);
      }).catch((e: any) => {
        if (sequence !== this.sequence) return;
        const label = { monthly: '毎月の処理', santei: '算定基礎届', bonus: '賞与' }[t.kind];
        this.todos.update(list => [...(list ?? []), {
          id: `${t.kind}-${t.officeId}-${t.period}`, kind: t.kind, title: `${label}（${t.period}）`, next: '状況を読み込めませんでした',
          detail: e?.message && e.message !== 'INTERNAL' ? e.message : '「最新にする」でもう一度読み込んでください', officeName: t.officeName,
          deadline: null, tone: 'action', route: `/${t.kind}`, queryParams: { officeId: t.officeId }, updatedAt: null,
        }]);
      }).finally(() => {
        if (sequence === this.sequence) this.bulkPending.update(n => n - 1);
      });
    }
  }

  open(todo: HomeTodo) { void this.router.navigate([todo.route], { queryParams: todo.queryParams }); }

  private days(deadline: string) {
    return Math.round((Date.parse(deadline) - Date.parse(this.today())) / 86_400_000);
  }
  overdue(todo: HomeTodo) { return !!todo.deadline && this.days(todo.deadline) < 0; }
  /** 期限まで7日以内 */
  soon(todo: HomeTodo) { return !!todo.deadline && this.days(todo.deadline) >= 0 && this.days(todo.deadline) <= 7; }
  shortDate(d: string) { const [, m, day] = d.split('-'); return `${Number(m)}月${Number(day)}日`; }
  daysLabel(d: string) {
    const n = this.days(d);
    return n < 0 ? `${-n}日過ぎています` : n === 0 ? '今日まで' : `あと${n}日`;
  }
}
