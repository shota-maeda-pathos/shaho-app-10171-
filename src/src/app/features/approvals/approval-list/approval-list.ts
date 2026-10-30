import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../../core/services/auth.service';
import { OfficeContextService } from '../../../core/services/office-context.service';
import { ApprovalBadgeService } from '../../../core/services/approval-badge.service';
import { EmptyStateComponent, ErrorStateComponent, LoadingStateComponent, StatusBadgeComponent, StatusTone } from '../../../shared/ui';
import { filingTypeLabel } from '../../filings/filing-labels';
import { errorMessage } from '../../onboarding/onboarding.types';

type Kind = 'request' | 'runFiling';
interface ApprovalItem {
  id: string; kind: Kind; requestId: string; employeeId: string | null; employeeName: string; employeeNumber: string;
  officeId: string; officeName: string; requestType: string; filingType: string | null; source: 'employee' | 'santei' | 'bonus' | null;
  parentId: string | null; filingId: string | null; year: number | null; payMonth: string | null; personCount: number;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'; requestedBy: string | null; requestedByName: string; requestedAt: string | null;
  reviewedAt: string | null; comment: string | null; targetVersion: number; deadline: string | null; deadlineNote: string | null;
  summary: string; mine: boolean; canApprove: boolean; overdue: boolean; dueSoon: boolean; stale: boolean;
}
interface SearchResult { items: ApprovalItem[]; total: number; summary: { pending: number; forMe: number; overdue: number; stale: number; mine: number }; staleDays: number }
interface Detail {
  status: string; filingType: string | null; content: Record<string, unknown>; metadata: Record<string, unknown> | null;
  diff: { field: string; before: string; after: string }[]; previous: { status: string; requestedAt: string | null; comment: string | null } | null;
  note: string | null; tampered: boolean; changedSinceRequest: boolean;
  history: { id: string; status: string; requestedAt: string | null; requestedBy: string; reviewedAt: string | null; reviewedBy: string | null; comment: string | null; cancelReason: string | null }[];
}
type Act = { kind: 'bulk' } | { kind: 'approve' | 'reject' | 'cancel'; item: ApprovalItem };

const TYPE_LABELS: Record<string, string> = {
  filing: '届出', salary: '給与', monthlyInsurance: '月々の保険料', bonus: '賞与額', bonusInsurance: '賞与の保険料', grade: '等級', employment: '雇用条件',
};
const STATUS: Record<string, { label: string; tone: StatusTone }> = {
  pending: { label: '承認待ち', tone: 'waiting' }, approved: { label: '承認済み', tone: 'done' },
  rejected: { label: '差戻し', tone: 'action' }, cancelled: { label: '承認取消', tone: 'action' },
};

/** 横断の承認一覧。届出・給与・保険料・等級・雇用条件と、算定基礎届・賞与支払届の承認をまとめて扱う */
@Component({
  selector: 'app-approval-list',
  standalone: true,
  imports: [
    DatePipe, FormsModule, RouterLink, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule,
    StatusBadgeComponent, LoadingStateComponent, ErrorStateComponent, EmptyStateComponent,
  ],
  template: `
    <div class="page">
      <header>
        <h1>承認</h1>
        <p class="sub">期限の近い順に並べています。届出の中身は「中身を見る」で前回の版との違いと一緒に確かめられます。
          毎月の給与・保険料は<a routerLink="/monthly">毎月の処理</a>の画面でもまとめて承認できます。</p>
      </header>

      @if (summary(); as s) {
        <div class="cards" role="group" aria-label="承認の状況">
          @if (canApproveRole) {
            <button type="button" class="card" [class.on]="only === 'forMe'" (click)="toggleOnly('forMe')"><span class="num">{{ s.forMe }}</span><span>あなたが承認できる</span></button>
          }
          <button type="button" class="card warn" [class.on]="only === 'overdue'" (click)="toggleOnly('overdue')"><span class="num">{{ s.overdue }}</span><span>届出の期限を過ぎている</span></button>
          <button type="button" class="card warn" [class.on]="only === 'stale'" (click)="toggleOnly('stale')"><span class="num">{{ s.stale }}</span><span>{{ staleDays() }}日以上止まっている</span></button>
          <button type="button" class="card" [class.on]="only === 'mine'" (click)="toggleOnly('mine')"><span class="num">{{ s.mine }}</span><span>自分が依頼した</span></button>
        </div>
      }

      <div class="toolbar">
        <div class="tabs" role="tablist">
          <button type="button" role="tab" [attr.aria-selected]="view === 'pending'" [class.on]="view === 'pending'" (click)="setView('pending')">承認待ち（{{ summary()?.pending ?? 0 }}）</button>
          <button type="button" role="tab" [attr.aria-selected]="view === 'processed'" [class.on]="view === 'processed'" (click)="setView('processed')">処理済み</button>
        </div>
        <mat-form-field appearance="outline">
          <mat-label>種類</mat-label>
          <mat-select [(ngModel)]="requestType" (selectionChange)="load()">
            <mat-option value="">すべて</mat-option>
            @for (t of types; track t[0]) { <mat-option [value]="t[0]">{{ t[1] }}</mat-option> }
          </mat-select>
        </mat-form-field>
        @if (view === 'pending') {
          <mat-form-field appearance="outline">
            <mat-label>並べ方</mat-label>
            <mat-select [(ngModel)]="sort" (selectionChange)="load()">
              <mat-option value="deadline">届出の期限の近い順</mat-option>
              <mat-option value="requestedAt">依頼の古い順</mat-option>
              <mat-option value="office">事業所の順</mat-option>
            </mat-select>
          </mat-form-field>
        }
        <mat-form-field appearance="outline">
          <mat-label>氏名・内容で探す</mat-label>
          <input matInput [(ngModel)]="keyword" (keydown.enter)="load()">
        </mat-form-field>
        <button mat-stroked-button type="button" (click)="load()"><mat-icon>refresh</mat-icon> 読み込み直す</button>
      </div>

      @if (view === 'pending' && approvable().length) {
        <div class="bulk">
          <mat-checkbox [checked]="allSelected()" [indeterminate]="selected().size > 0 && !allSelected()" (change)="toggleAll($event.checked)">
            あなたが承認できる{{ approvable().length }}件をすべて選ぶ
          </mat-checkbox>
          <button mat-flat-button type="button" [disabled]="!selected().size || busy()" (click)="ask({ kind: 'bulk' })">選んだ{{ selected().size }}件を承認する</button>
        </div>
      }

      @if (act(); as a) {
        <div class="confirm" role="alertdialog" aria-label="確認">
          @if (a.kind === 'bulk') {
            <p><strong>次の{{ selectedItems().length }}件をまとめて承認します。</strong>内容を目で確かめてから承認してください。</p>
            <ul class="bulk-list">
              @for (i of selectedItems(); track i.id) {
                <li>{{ typeLabel(i) }}：{{ targetLabel(i) }}{{ i.summary ? '（' + i.summary + '）' : '' }}@if (i.deadline) { ・期限 {{ i.deadline }} }</li>
              }
            </ul>
            <mat-form-field appearance="outline" class="wide"><mat-label>コメント（任意）</mat-label><input matInput [(ngModel)]="note"></mat-form-field>
          } @else {
            <p>{{ confirmText(a) }}</p>
            <mat-form-field appearance="outline" class="wide">
              <mat-label>{{ a.kind === 'approve' ? 'コメント（任意）' : '理由（必須）' }}</mat-label>
              <input matInput [(ngModel)]="note">
            </mat-form-field>
          }
          <div class="actions">
            <button mat-flat-button type="button" (click)="run(a)" [disabled]="busy() || (a.kind !== 'approve' && a.kind !== 'bulk' && !note.trim())">{{ confirmLabel(a) }}</button>
            <button mat-button type="button" (click)="act.set(null)" [disabled]="busy()">やめる</button>
          </div>
        </div>
      }

      @if (failures().length) {
        <div class="alert" role="alert">
          <strong>承認できなかったものがあります（{{ failures().length }}件）</strong>
          <ul>@for (f of failures(); track $index) { <li>{{ f }}</li> }</ul>
        </div>
      }

      @if (loading()) {
        <app-loading-state message="承認の一覧を読み込んでいます…" />
      } @else if (error()) {
        <app-error-state [message]="error()" (retry)="load()" />
      } @else if (!items().length) {
        <app-empty-state [message]="view === 'pending' ? '承認待ちはありません' : '処理済みの承認はありません'" icon="task_alt" />
      } @else {
        <p class="count" role="status">{{ total() }}件{{ total() > items().length ? '（先頭の' + items().length + '件）' : '' }}</p>
        <ul class="list">
          @for (i of items(); track i.id) {
            <li [class.overdue]="i.overdue" [class.stale]="i.stale">
              <div class="row">
                @if (view === 'pending') {
                  <mat-checkbox [checked]="selected().has(i.id)" [disabled]="!i.canApprove" (change)="toggle(i, $event.checked)"
                    [attr.aria-label]="targetLabel(i) + 'を選ぶ'" />
                }
                <div class="main">
                  <div class="title">
                    <strong>{{ typeLabel(i) }}</strong>
                    <span>{{ targetLabel(i) }}</span>
                    <span class="muted">{{ i.officeName }}</span>
                    <app-status-badge [tone]="statusOf(i).tone" [label]="statusOf(i).label" />
                    @if (i.overdue) { <span class="flag bad">期限超過</span> }
                    @else if (i.dueSoon) { <span class="flag warn">期限が近い</span> }
                    @if (i.stale) { <span class="flag warn">{{ staleDays() }}日以上止まっている</span> }
                    @if (i.mine && i.status === 'pending') { <span class="flag">自分の依頼（ほかの人が承認します）</span> }
                  </div>
                  @if (i.summary) { <div class="summary">{{ i.summary }}</div> }
                  <div class="meta">
                    @if (i.deadline) { 届出の期限 {{ i.deadline }} ・ } @else if (i.deadlineNote) { 届出の期限 {{ i.deadlineNote }} ・ }
                    依頼 {{ i.requestedByName || '—' }} {{ i.requestedAt | date:'M/d H:mm' }}
                    @if (i.reviewedAt) { ・ 処理 {{ i.reviewedAt | date:'M/d H:mm' }} }
                    @if (i.comment && i.status !== 'pending') { ・ {{ i.comment }} }
                  </div>
                </div>
                <div class="row-actions">
                  <button mat-button type="button" (click)="toggleDetail(i)" [attr.aria-expanded]="openId() === i.id">{{ openId() === i.id ? '閉じる' : '中身を見る' }}</button>
                  @if (i.canApprove) {
                    <button mat-flat-button type="button" (click)="ask({ kind: 'approve', item: i })" [disabled]="busy()">承認</button>
                    <button mat-stroked-button type="button" (click)="ask({ kind: 'reject', item: i })" [disabled]="busy()">差し戻す</button>
                  }
                  @if (i.status === 'approved' && i.requestType === 'filing') {
                    <button mat-button type="button" (click)="ask({ kind: 'cancel', item: i })" [disabled]="busy()">承認を取り消す</button>
                  }
                </div>
              </div>

              @if (openId() === i.id) {
                <div class="detail">
                  @if (detailLoading()) { <p class="muted" role="status">読み込んでいます…</p> }
                  @else if (detail(); as d) {
                    @if (d.tampered) { <div class="alert" role="alert">承認したあとに届出の内容が書き換えられています。送信・提出はできません。承認を取り消して確かめ直してください。</div> }
                    @if (d.changedSinceRequest) { <div class="alert" role="alert">承認を依頼したあとに対象が変わっています。承認はできないので、差し戻して依頼し直してもらってください。</div> }
                    <h3>前回の版との違い</h3>
                    @if (d.note) { <p class="muted">{{ d.note }}</p> }
                    @else if (!d.previous) { <p class="muted">前回の版はありません（初めての依頼です）。</p> }
                    @else if (!d.diff.length) { <p class="muted">前回（{{ statusOf2(d.previous.status) }}{{ d.previous.comment ? '：' + d.previous.comment : '' }}）から内容は変わっていません。</p> }
                    @else {
                      <p class="muted">前回（{{ statusOf2(d.previous.status) }}{{ d.previous.comment ? '：' + d.previous.comment : '' }}）から変わった項目を強調しています。</p>
                      <div class="table-wrap">
                        <table class="diff">
                          <thead><tr><th>項目</th><th>前回</th><th>今回</th></tr></thead>
                          <tbody>@for (r of d.diff; track r.field) { <tr><th>{{ r.field }}</th><td class="before">{{ r.before || '（空欄）' }}</td><td class="after">{{ r.after || '（空欄）' }}</td></tr> }</tbody>
                        </table>
                      </div>
                    }
                    <details>
                      <summary>記入内容をすべて見る</summary>
                      <dl class="content">
                        @for (e of entries(d.content); track e[0]) { <div><dt>{{ e[0] }}</dt><dd>{{ e[1] }}</dd></div> }
                      </dl>
                    </details>
                    @if (d.history.length > 1) {
                      <details>
                        <summary>この対象の承認の経緯（{{ d.history.length }}件）</summary>
                        <ul class="history">
                          @for (h of d.history; track h.id) {
                            <li>{{ h.requestedAt | date:'M/d H:mm' }} {{ h.requestedBy }}が依頼 → {{ statusOf2(h.status) }}
                              @if (h.reviewedAt) { （{{ h.reviewedAt | date:'M/d H:mm' }} {{ h.reviewedBy }}） }
                              @if (h.comment) { ：{{ h.comment }} } @if (h.cancelReason) { ／取消の理由：{{ h.cancelReason }} }</li>
                          }
                        </ul>
                      </details>
                    }
                    <p class="links">@if (linkOf(i); as l) { <a [routerLink]="l.path" [queryParams]="l.query">{{ l.label }}</a> }</p>
                  }
                </div>
              }
            </li>
          }
        </ul>
      }
    </div>
  `,
  styles: [`
    .page { padding: var(--app-space-5); max-width: 1200px; }
    h1 { margin: 0; font-size: 24px; font-weight: 500; }
    h3 { font-size: 15px; margin: var(--app-space-2) 0; }
    .sub, .muted { color: var(--app-color-text-sub); }
    .muted { font-size: 13px; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: var(--app-space-3); margin: var(--app-space-4) 0; }
    .card { display: flex; flex-direction: column; align-items: flex-start; padding: var(--app-space-3) var(--app-space-4); border: 1px solid var(--app-color-border);
      border-radius: 8px; background: var(--app-color-surface); cursor: pointer; font: inherit; color: var(--app-color-text); text-align: left; }
    .card .num { font-size: 24px; font-weight: 600; }
    .card.warn .num { color: var(--app-status-action-fg); }
    .card.on { border-color: var(--app-color-link); box-shadow: 0 0 0 1px var(--app-color-link) inset; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 0 var(--app-space-3); align-items: center; }
    .toolbar mat-form-field { width: 200px; }
    .tabs { display: flex; gap: 2px; margin-bottom: 20px; }
    .tabs button { padding: 8px 16px; border: 1px solid var(--app-color-border); background: var(--app-color-surface); cursor: pointer; font: inherit; }
    .tabs button.on { background: var(--app-status-yours-bg); border-color: var(--app-color-link); color: var(--app-status-yours-fg); font-weight: 500; }
    .bulk { display: flex; flex-wrap: wrap; gap: var(--app-space-3); align-items: center; padding: var(--app-space-2) var(--app-space-3);
      border: 1px solid var(--app-color-border); border-radius: 8px; background: var(--app-color-surface-sub); margin-bottom: var(--app-space-3); }
    .confirm { margin-bottom: var(--app-space-3); padding: var(--app-space-3) var(--app-space-4); border: 1px solid var(--app-color-link); border-radius: 8px; background: var(--app-status-yours-bg); }
    .bulk-list { max-height: 240px; overflow: auto; margin: var(--app-space-2) 0; padding-left: var(--app-space-5); font-size: 14px; }
    .wide { width: min(100%, 480px); }
    .actions, .row-actions { display: flex; flex-wrap: wrap; gap: var(--app-space-2); align-items: center; }
    .alert { margin-bottom: var(--app-space-3); padding: var(--app-space-3) var(--app-space-4); border-radius: 8px; background: var(--app-status-action-bg); }
    .count { color: var(--app-color-text-sub); margin: 0 0 var(--app-space-2); }
    .list { list-style: none; margin: 0; padding: 0; border: 1px solid var(--app-color-border); border-radius: 8px; background: var(--app-color-surface); }
    .list > li { padding: var(--app-space-3) var(--app-space-4); border-bottom: 1px solid var(--app-color-border); }
    .list > li:last-child { border-bottom: 0; }
    .list > li.overdue { border-left: 4px solid var(--app-status-action-fg); }
    .list > li.stale:not(.overdue) { border-left: 4px solid #f9a825; }
    .row { display: flex; gap: var(--app-space-3); align-items: flex-start; }
    .main { flex: 1; min-width: 0; }
    .title { display: flex; flex-wrap: wrap; gap: var(--app-space-2); align-items: center; }
    .summary { margin-top: 2px; }
    .meta { margin-top: 2px; font-size: 13px; color: var(--app-color-text-sub); }
    .flag { padding: 0 8px; border-radius: 10px; font-size: 12px; background: var(--app-status-waiting-bg); color: var(--app-status-waiting-fg); }
    .flag.bad { background: var(--app-status-action-bg); color: var(--app-status-action-fg); }
    .flag.warn { background: #fff8e1; color: #8d6e00; }
    .detail { margin: var(--app-space-3) 0 0 var(--app-space-6); padding: var(--app-space-3); border-radius: 8px; background: var(--app-color-surface-sub); }
    .table-wrap { overflow-x: auto; }
    .diff { border-collapse: collapse; font-size: 14px; }
    .diff th, .diff td { padding: 4px 10px; border-bottom: 1px solid var(--app-color-border); text-align: left; }
    .diff thead th { color: var(--app-color-text-sub); font-weight: 500; }
    .diff td.before { color: var(--app-color-text-sub); text-decoration: line-through; }
    .diff td.after { background: #fff59d; font-weight: 500; }
    details { margin-top: var(--app-space-2); }
    summary { cursor: pointer; color: var(--app-color-link); }
    .content { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 4px var(--app-space-4); font-size: 13px; }
    .content dt { color: var(--app-color-text-sub); }
    .content dd { margin: 0; word-break: break-all; }
    .history { font-size: 13px; padding-left: var(--app-space-5); }
    .links { margin: var(--app-space-2) 0 0; }
    @media (max-width: 600px) {
      .page { padding: var(--app-space-4); }
      .row { flex-wrap: wrap; }
      .toolbar mat-form-field { width: 100%; }
      .detail { margin-left: 0; }
    }
  `],
})
export class ApprovalListComponent {
  private office = inject(OfficeContextService);
  private functions = inject(Functions);
  private snackBar = inject(MatSnackBar);
  private auth = inject(AuthService);
  private badge = inject(ApprovalBadgeService);

  items = signal<ApprovalItem[]>([]);
  total = signal(0);
  summary = signal<SearchResult['summary'] | null>(null);
  staleDays = signal(3);
  loading = signal(false);
  error = signal('');
  busy = signal(false);
  selected = signal(new Set<string>());
  act = signal<Act | null>(null);
  failures = signal<string[]>([]);
  openId = signal<string | null>(null);
  detail = signal<Detail | null>(null);
  detailLoading = signal(false);

  view: 'pending' | 'processed' = 'pending';
  only: '' | 'forMe' | 'mine' | 'overdue' | 'stale' = '';
  requestType = '';
  sort: 'deadline' | 'requestedAt' | 'office' = 'deadline';
  keyword = '';
  note = '';

  canApproveRole = this.auth.hasAnyRole('admin', 'approver');
  types = Object.entries(TYPE_LABELS);
  approvable = computed(() => this.items().filter(i => i.canApprove));
  allSelected = computed(() => this.approvable().length > 0 && this.approvable().every(i => this.selected().has(i.id)));
  selectedItems = computed(() => this.items().filter(i => this.selected().has(i.id)));

  constructor() {
    if (this.canApproveRole) this.only = 'forMe';
    // 上部の事業所を選んだ・切り替えたら読み込み直す（承認待ちの見落としを防ぐ）
    effect(() => {
      this.office.selected();
      untracked(() => void this.load());
    });
  }

  typeLabel(i: ApprovalItem) {
    if (i.requestType === 'filing' && i.filingType) return filingTypeLabel(i.filingType);
    return TYPE_LABELS[i.requestType] ?? i.requestType;
  }
  targetLabel(i: ApprovalItem) {
    if (i.kind === 'runFiling') return `${i.personCount}名分`;
    return `${i.employeeName}${i.employeeNumber ? `（${i.employeeNumber}）` : ''}`;
  }
  statusOf = (i: ApprovalItem) => STATUS[i.status] ?? { label: i.status, tone: 'waiting' as StatusTone };
  statusOf2 = (s: string) => STATUS[s]?.label ?? s;
  entries = (o: Record<string, unknown>) => Object.entries(o).filter(([, v]) => typeof v !== 'object' || v === null).map(([k, v]) => [k, v === null || v === '' ? '—' : typeof v === 'number' ? v.toLocaleString('ja-JP') : String(v)]);

  linkOf(i: ApprovalItem): { path: string[]; query: Record<string, unknown>; label: string } | null {
    if (i.kind === 'runFiling' && i.source === 'santei') return { path: ['/santei'], query: { officeId: i.officeId, year: i.year }, label: '算定基礎届の画面で内容とPDFを確かめる' };
    if (i.kind === 'runFiling') return { path: ['/bonus'], query: { officeId: i.officeId, month: i.payMonth }, label: '賞与の画面で内容とPDFを確かめる' };
    if (i.requestType === 'filing' && i.filingId) return { path: ['/filings', i.filingId], query: { employeeId: i.employeeId }, label: '届出の画面でPDFを確かめる' };
    if (i.requestType === 'salary' || i.requestType === 'monthlyInsurance') return { path: ['/monthly'], query: { officeId: i.officeId }, label: '毎月の処理の画面で確かめる' };
    if (i.requestType === 'bonus' || i.requestType === 'bonusInsurance') return { path: ['/bonus'], query: { officeId: i.officeId }, label: '賞与の画面で確かめる' };
    if (i.employeeId) return { path: ['/employees', i.employeeId], query: {}, label: '従業員の画面を開く' };
    return null;
  }

  setView(v: 'pending' | 'processed') {
    this.view = v;
    this.only = '';
    void this.load();
  }

  toggleOnly(o: 'forMe' | 'mine' | 'overdue' | 'stale') {
    this.only = this.only === o ? '' : o;
    this.view = 'pending';
    void this.load();
  }

  toggle(i: ApprovalItem, on: boolean) {
    const next = new Set(this.selected());
    if (on) next.add(i.id); else next.delete(i.id);
    this.selected.set(next);
  }

  toggleAll(on: boolean) {
    this.selected.set(new Set(on ? this.approvable().map(i => i.id) : []));
  }

  ask(a: Act) {
    this.note = '';
    this.act.set(a);
  }

  confirmText(a: Exclude<Act, { kind: 'bulk' }>) {
    const what = `${this.typeLabel(a.item)}（${this.targetLabel(a.item)}）`;
    if (a.kind === 'approve') return `${what}を承認します。中身を確かめましたか？`;
    if (a.kind === 'reject') return `${what}を差し戻します。依頼した人が理由を見て直します。`;
    return `${what}の承認を取り消し、下書きに戻します。届出の承認で確定した等級・保険料の免除も元に戻します。取り消したあとは、もう一度承認を受けるまで提出できません。`;
  }

  confirmLabel(a: Act) {
    return { bulk: 'まとめて承認する', approve: '承認する', reject: '差し戻す', cancel: '承認を取り消す' }[a.kind];
  }

  private target(i: ApprovalItem) {
    return i.kind === 'runFiling'
      ? { kind: 'runFiling', source: i.source, parentId: i.parentId, filingId: i.filingId }
      : { kind: 'request', employeeId: i.employeeId, requestId: i.requestId };
  }

  async run(a: Act) {
    this.busy.set(true);
    this.failures.set([]);
    const companyId = this.auth.companyId;
    try {
      if (a.kind === 'bulk' || a.kind === 'approve') {
        const list = a.kind === 'bulk' ? this.selectedItems() : [a.item];
        const { data } = await httpsCallable<object, { approved: number; results: { ok: boolean; message: string | null }[] }>(
          this.functions, 'approvalBulkApprove', { timeout: 540_000 },
        )({ companyId, items: list.map(i => this.target(i)), ...(this.note.trim() ? { comment: this.note.trim() } : {}) });
        const failed = data.results.map((r, n) => (r.ok ? null : `${this.typeLabel(list[n])}（${this.targetLabel(list[n])}）：${r.message}`)).filter((x): x is string => !!x);
        this.failures.set(failed);
        this.snackBar.open(`${data.approved}件を承認しました${failed.length ? `（${failed.length}件はできませんでした）` : ''}`, '閉じる', { duration: 5000 });
        this.selected.set(new Set());
      } else if (a.kind === 'reject') {
        const i = a.item;
        if (i.kind === 'request') {
          await httpsCallable(this.functions, 'approvalRequestReject')({ companyId, employeeId: i.employeeId, requestId: i.requestId, comment: this.note.trim() });
        } else {
          await httpsCallable(this.functions, i.source === 'santei' ? 'santeiFilingUpdate' : 'bonusFilingUpdate')({
            companyId, officeId: i.officeId, ...(i.source === 'santei' ? { year: i.year } : { payMonth: i.payMonth }),
            filingId: i.filingId, expectedVersion: i.targetVersion, action: 'reject', comment: this.note.trim(),
          });
        }
        this.snackBar.open('差し戻しました', '閉じる', { duration: 4000 });
      } else {
        await httpsCallable(this.functions, 'approvalCancel')({ companyId, target: this.target(a.item), reason: this.note.trim() });
        this.snackBar.open('承認を取り消し、下書きに戻しました', '閉じる', { duration: 4000 });
      }
      this.act.set(null);
      this.openId.set(null);
      await this.load();
      void this.badge.refresh();
    } catch (e) {
      this.snackBar.open(errorMessage(e, '操作できませんでした'), '閉じる', { duration: 8000 });
    } finally {
      this.busy.set(false);
    }
  }

  async toggleDetail(i: ApprovalItem) {
    if (this.openId() === i.id) { this.openId.set(null); return; }
    this.openId.set(i.id);
    this.detail.set(null);
    this.detailLoading.set(true);
    try {
      const { data } = await httpsCallable<object, Detail>(this.functions, 'approvalDetailGet')({ companyId: this.auth.companyId, target: this.target(i) });
      if (this.openId() === i.id) this.detail.set(data);
    } catch (e) {
      this.snackBar.open(errorMessage(e, '中身を読み込めませんでした'), '閉じる', { duration: 6000 });
    } finally {
      this.detailLoading.set(false);
    }
  }

  async load() {
    this.loading.set(true);
    this.error.set('');
    try {
      const { data } = await httpsCallable<object, SearchResult & { staleDays: number }>(this.functions, 'approvalSearch')({
        companyId: this.auth.companyId, ...this.office.params(), view: this.view,
        ...(this.only ? { only: this.only } : {}), ...(this.requestType ? { requestType: this.requestType } : {}),
        ...(this.keyword.trim() ? { keyword: this.keyword.trim() } : {}), ...(this.view === 'pending' ? { sort: this.sort } : {}),
      });
      this.items.set(data.items);
      this.total.set(data.total);
      this.summary.set(data.summary);
      this.staleDays.set(data.staleDays);
      const ids = new Set(data.items.map(i => i.id));
      this.selected.set(new Set([...this.selected()].filter(id => ids.has(id))));
    } catch (e) {
      this.error.set(errorMessage(e, '承認の一覧を読み込めませんでした'));
    } finally {
      this.loading.set(false);
    }
  }
}
