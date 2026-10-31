import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../core/services/auth.service';
import { OfficeContextService } from '../../core/services/office-context.service';
import { EmptyStateComponent, ErrorStateComponent, LoadingStateComponent, PageHeadComponent, StatusBadgeComponent, StatusTone } from '../../shared/ui';

/** ホームと同じ「やること」（functions/src/home の HomeTodo） */
interface Todo {
  id: string; kind: string; title: string; next: string; detail: string | null; officeName: string; deadline: string | null;
  tone: 'action' | 'yours' | 'waiting'; route: string; queryParams: Record<string, string>; updatedAt: string | null;
}
interface BulkTarget { kind: 'monthly' | 'santei' | 'bonus'; officeId: string; period: string; officeName: string }

/** 完了した手続き（procedureList の1件） */
interface DoneRow { id: string; procedureType: string; title: string; officeId: string; updatedAt: string }

const KIND_LABELS: Record<string, string> = {
  onboarding: '入社', resignation: '退職', dependent: '扶養', leave: '産休・育休', revision: '等級の見直し', age: '年齢到達',
  contract: '有期契約', employment: '雇用条件の変更', transfer: '事業所間の異動', procedure: 'その他', monthly: '毎月の処理', santei: '算定基礎届', bonus: '賞与',
};
const TYPE_LABELS: Record<string, string> = {
  acquisition: '入社', loss: '退職', dependent_change: '扶養', maternity_leave: '産休', childcare_leave: '育休', monthly_change: '等級の見直し',
  annual_review: '算定基礎届', bonus_payment: '賞与', transfer: '事業所間の異動', age_event: '年齢到達', employment_change: '雇用条件の変更',
};

type Tab = 'active' | 'done';
type Who = 'all' | 'mine' | 'waiting';

/**
 * 手続き一覧（docs/ui-unification-design.md の5章）。進行中は待ちも含めた全件で、ホームと同じ判定・同じ行き先にする
 * （ホームと同じ homeTodos・homeBulkTodo を使う）。完了した手続きは procedureList から読む。
 */
@Component({
  selector: 'app-procedure-list',
  standalone: true,
  imports: [FormsModule, RouterLink, MatButtonModule, MatIconModule, MatProgressSpinnerModule, PageHeadComponent, StatusBadgeComponent, EmptyStateComponent, ErrorStateComponent, LoadingStateComponent],
  template: `
    <div class="app-page">
      <app-page-head heading="手続き">
        <ng-container meta>
          <span>進行中 <b>{{ active().length }}件</b></span>
          <span>あなたの番 <b>{{ mineCount() }}件</b></span>
          <span>{{ office.label() }}</span>
        </ng-container>
        @if (auth.hasAnyRole('admin', 'operator')) {
          <ng-container actions><a mat-flat-button routerLink="/procedures/new"><mat-icon>add</mat-icon>手続きを始める</a></ng-container>
        }
      </app-page-head>

      <section class="panel">
        <div class="tabs" role="tablist">
          <button type="button" role="tab" [class.on]="tab() === 'active'" [attr.aria-selected]="tab() === 'active'" (click)="tab.set('active')">進行中 <span class="badge">{{ active().length }}</span></button>
          <button type="button" role="tab" [class.on]="tab() === 'done'" [attr.aria-selected]="tab() === 'done'" (click)="openDone()">完了</button>
        </div>

        <div class="toolbar">
          <input class="search" type="search" [ngModel]="query()" (ngModelChange)="query.set($event)" placeholder="氏名・手続きの名前で探す" aria-label="氏名・手続きの名前で探す">
          @if (bulkPending()) { <span class="pending"><mat-spinner diameter="14"></mat-spinner>毎月の処理・賞与・算定を確かめています（残り {{ bulkPending() }}件）</span> }
          <span class="grow"></span>
          @if (tab() === 'active') {
            <div class="chips" role="group" aria-label="絞り込み">
              <button type="button" class="chip" [class.on]="who() === 'all'" (click)="who.set('all')">すべて <span class="n">{{ active().length }}</span></button>
              <button type="button" class="chip" [class.on]="who() === 'mine'" (click)="who.set('mine')">あなたの番 <span class="n">{{ mineCount() }}</span></button>
              <button type="button" class="chip" [class.on]="who() === 'waiting'" (click)="who.set('waiting')">待ち <span class="n">{{ active().length - mineCount() }}</span></button>
            </div>
          }
        </div>

        @if (error()) {
          <app-error-state [message]="error()" (retry)="load()" />
        } @else if (tab() === 'active') {
          @if (loading() && !todos()) {
            <app-loading-state message="手続きを集めています…" />
          } @else if (!visible().length && !bulkPending()) {
            <app-empty-state icon="task_alt" [message]="query() ? '探している手続きはありません' : '進行中の手続きはありません'" />
          } @else {
            <table class="list">
              <thead><tr><th>種類</th><th>手続き</th><th>いまのこと</th><th>次に動く人</th><th>期限</th><th>状態</th></tr></thead>
              <tbody>
                @for (t of visible(); track t.id) {
                  <tr (click)="open(t)" tabindex="0" (keydown.enter)="open(t)">
                    <td><span class="kind">{{ kindLabel(t.kind) }}</span></td>
                    <td class="who"><b>{{ t.title }}</b>@if (t.officeName && showOffice()) {<span>{{ t.officeName }}</span>}</td>
                    <td>{{ t.next }}@if (t.detail) {<div class="sub">{{ t.detail }}</div>}</td>
                    <td>{{ t.tone === 'waiting' ? waitingWho(t) : 'あなた' }}</td>
                    <td><span class="due" [class.over]="overdue(t)" [class.soon]="soon(t)">{{ t.deadline ? shortDate(t.deadline) : '—' }}</span></td>
                    <td><app-status-badge [tone]="toneOf(t)" [label]="toneOf(t) === 'attention' ? '要確認' : t.tone === 'waiting' ? '待ち' : 'あなたの番'" /></td>
                  </tr>
                }
              </tbody>
            </table>
          }
        } @else {
          @if (doneLoading() && !done().length) {
            <app-loading-state message="完了した手続きを読み込んでいます…" />
          } @else if (!visibleDone().length) {
            <app-empty-state icon="history" message="完了した手続きはありません" />
          } @else {
            <table class="list">
              <thead><tr><th>種類</th><th>手続き</th><th>完了した日</th><th></th></tr></thead>
              <tbody>
                @for (r of visibleDone(); track r.id) {
                  <tr (click)="openDoneRow(r)" tabindex="0" (keydown.enter)="openDoneRow(r)">
                    <td><span class="kind">{{ typeLabel(r.procedureType) }}</span></td>
                    <td class="who"><b>{{ r.title }}</b></td>
                    <td>{{ shortDate(r.updatedAt.slice(0, 10)) }}</td>
                    <td class="go"><mat-icon aria-hidden="true">chevron_right</mat-icon></td>
                  </tr>
                }
              </tbody>
            </table>
            @if (doneMore()) { <div class="more"><button mat-stroked-button type="button" (click)="loadDone(true)" [disabled]="doneLoading()">さらに読み込む</button></div> }
          }
        }
        <p class="foot">毎月の処理・算定基礎届・賞与は、事業所×月ごとに1行です。完了した毎月の処理などは、それぞれの画面で月を選んで見ます。</p>
      </section>
    </div>
  `,
  styles: [`
    .panel { border: 1px solid var(--app-color-border); border-radius: var(--app-radius); background: var(--app-color-surface); }
    .tabs { display: flex; gap: var(--app-space-5); padding: 0 var(--app-space-5); border-bottom: 1px solid var(--app-color-border); }
    .tabs button { border: 0; background: none; padding: 12px 0 10px; margin-bottom: -1px; font: inherit; font-weight: 600; color: var(--app-color-text-sub); border-bottom: 2px solid transparent; cursor: pointer; display: inline-flex; gap: 6px; align-items: center; }
    .tabs button.on { color: var(--app-color-text); border-bottom-color: var(--app-status-yours-fg); }
    .badge { font-size: 11px; padding: 0 6px; border-radius: 10px; background: var(--app-status-waiting-bg); }
    .toolbar { display: flex; align-items: center; gap: var(--app-space-2); flex-wrap: wrap; padding: var(--app-space-3) var(--app-space-5); }
    .grow { flex: 1; }
    .search { min-width: 240px; padding: 7px 12px; border: 1px solid var(--app-color-border); border-radius: var(--app-radius); font: inherit; font-size: var(--app-font-sm); }
    .pending { display: inline-flex; align-items: center; gap: var(--app-space-2); font-size: var(--app-font-sm); color: var(--app-color-text-sub); }
    .chips { display: flex; gap: var(--app-space-2); }
    .chip { display: inline-flex; gap: 6px; align-items: center; padding: 4px 12px; border: 1px solid var(--app-color-border); border-radius: var(--app-radius-pill); background: var(--app-color-surface); font: inherit; font-size: var(--app-font-xs); font-weight: 600; color: var(--app-color-text-sub); cursor: pointer; }
    .chip .n { font-weight: 500; opacity: .75; }
    .chip.on { background: #273447; border-color: #273447; color: #fff; }
    table.list { width: 100%; border-collapse: collapse; font-size: var(--app-font-md); }
    .list th { text-align: left; font-size: var(--app-font-xs); font-weight: 600; color: var(--app-color-text-sub); background: var(--app-color-surface-sub); white-space: nowrap; }
    .list th, .list td { padding: var(--app-space-2) var(--app-space-3); border-top: 1px solid var(--app-color-border); vertical-align: top; }
    .list th:first-child, .list td:first-child { padding-left: var(--app-space-5); }
    .list tbody tr { cursor: pointer; }
    .list tbody tr:hover td { background: #fafbfd; }
    .list tbody tr:focus-visible { outline: 2px solid var(--app-color-link); outline-offset: -2px; }
    .kind { font-size: var(--app-font-xs); font-weight: 600; padding: 1px 7px; border-radius: 4px; background: var(--app-status-waiting-bg); color: var(--app-color-text-sub); white-space: nowrap; }
    .who b { display: block; font-weight: 600; }
    .who span, .sub { display: block; font-size: var(--app-font-xs); color: var(--app-color-text-sub); }
    .due { white-space: nowrap; font-variant-numeric: tabular-nums; }
    .due.soon { color: var(--app-status-attention-fg); font-weight: 700; }
    .due.over { color: var(--app-status-error-fg); font-weight: 700; }
    .go { text-align: right; color: var(--app-color-text-sub); }
    .more { text-align: center; padding: var(--app-space-3); }
    .foot { margin: 0; padding: var(--app-space-3) var(--app-space-5); border-top: 1px solid var(--app-color-border); font-size: var(--app-font-xs); color: var(--app-color-text-sub); }
  `],
})
export class ProcedureListComponent {
  office = inject(OfficeContextService);
  auth = inject(AuthService);
  private functions = inject(Functions);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  tab = signal<Tab>('active');
  who = signal<Who>('all');
  query = signal('');
  /** 上部バーの検索（?q=）から来たら、その言葉で絞り込む */
  private queryParam = toSignal(this.route.queryParamMap);
  private syncQuery = effect(() => { const q = this.queryParam()?.get('q'); if (q != null) untracked(() => this.query.set(q)); });
  todos = signal<Todo[] | null>(null);
  today = signal(new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }));
  loading = signal(false);
  error = signal('');
  bulkPending = signal(0);
  done = signal<DoneRow[]>([]);
  doneLoading = signal(false);
  doneMore = signal(false);
  private doneCursor = '';
  private sequence = 0;

  active = computed(() => [...(this.todos() ?? [])].sort((a, b) => (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999')));
  mineCount = computed(() => this.active().filter(t => t.tone !== 'waiting').length);
  visible = computed(() => {
    const q = this.query().trim();
    return this.active().filter(t =>
      (this.who() === 'all' || (this.who() === 'mine') === (t.tone !== 'waiting'))
      && (!q || `${t.title} ${t.next} ${this.kindLabel(t.kind)}`.includes(q)));
  });
  visibleDone = computed(() => {
    const q = this.query().trim();
    return this.done().filter(r => !q || `${r.title} ${this.typeLabel(r.procedureType)}`.includes(q));
  });
  showOffice = computed(() => !this.office.selected() && this.office.offices().length > 1);

  constructor() {
    // 事業所を切り替えたら読み込み直す
    effect(() => {
      this.office.selected();
      untracked(() => {
        this.done.set([]);
        void this.load();
        if (this.tab() === 'done') void this.loadDone(false);
      });
    });
  }

  kindLabel(kind: string) { return KIND_LABELS[kind] ?? kind; }
  typeLabel(type: string) { return TYPE_LABELS[type] ?? type; }
  toneOf(t: Todo): StatusTone { return t.tone === 'action' ? 'attention' : t.tone; }
  /** 待っている相手（「承認者の確認を待っています」などの文言から短く） */
  waitingWho(t: Todo) {
    return /本人/.test(t.next) ? '本人' : /承認/.test(t.next) ? '承認者' : /処理しています/.test(t.next) ? 'システム' : 'ほかの人';
  }

  async load() {
    const sequence = ++this.sequence;
    this.loading.set(true);
    this.error.set('');
    try {
      const { data } = await httpsCallable<object, { today: string; items: Todo[]; bulk: BulkTarget[] }>(this.functions, 'homeTodos', { timeout: 60_000 })({
        companyId: this.auth.companyId, ...this.office.params(), deferBulk: true,
      });
      if (sequence !== this.sequence) return;
      this.today.set(data.today);
      this.todos.set(data.items);
      this.bulkPending.set(data.bulk.length);
      for (const b of data.bulk) {
        httpsCallable<object, { item: Todo | null }>(this.functions, 'homeBulkTodo', { timeout: 60_000 })({
          companyId: this.auth.companyId, kind: b.kind, officeId: b.officeId, period: b.period,
        }).then(({ data: r }) => {
          if (sequence === this.sequence && r.item) this.todos.update(list => [...(list ?? []), r.item!]);
        }).catch(() => undefined) // 読めなかった月はホームで「読み込めませんでした」と出る
          .finally(() => { if (sequence === this.sequence) this.bulkPending.update(n => n - 1); });
      }
    } catch (e: any) {
      if (sequence === this.sequence) this.error.set(e?.message && e.message !== 'INTERNAL' ? e.message : '手続きを読み込めませんでした');
    } finally {
      if (sequence === this.sequence) this.loading.set(false);
    }
  }

  openDone() {
    this.tab.set('done');
    if (!this.done().length) void this.loadDone(false);
  }

  async loadDone(more: boolean) {
    this.doneLoading.set(true);
    try {
      const { data } = await httpsCallable<object, { items: DoneRow[]; hasMore: boolean; lastDocId?: string }>(this.functions, 'procedureList')({
        companyId: this.auth.companyId, ...this.office.params(), status: 'completed', limit: 50, ...(more && this.doneCursor ? { cursor: this.doneCursor } : {}),
      });
      this.done.update(list => more ? [...list, ...data.items] : data.items);
      this.doneMore.set(data.hasMore);
      this.doneCursor = data.lastDocId ?? '';
    } catch (e: any) {
      this.error.set(e?.message && e.message !== 'INTERNAL' ? e.message : '完了した手続きを読み込めませんでした');
    } finally {
      this.doneLoading.set(false);
    }
  }

  open(t: Todo) { void this.router.navigate([t.route], { queryParams: t.queryParams }); }
  /** 完了した手続きは手続きの詳細を開く（ウィザード方式はそこから、それぞれの画面へ移る） */
  openDoneRow(r: DoneRow) { void this.router.navigate(['/procedures', r.id]); }

  private days(d: string) { return Math.round((Date.parse(d) - Date.parse(this.today())) / 86_400_000); }
  overdue(t: Todo) { return !!t.deadline && this.days(t.deadline) < 0; }
  soon(t: Todo) { return !!t.deadline && this.days(t.deadline) >= 0 && this.days(t.deadline) <= 7; }
  shortDate(d: string) { const [y, m, day] = d.split('-'); return `${y}/${Number(m)}/${Number(day)}`; }
}
