import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../../core/services/auth.service';
import { OfficeContextService } from '../../../core/services/office-context.service';
import { ApprovalBadgeService } from '../../../core/services/approval-badge.service';
import { EmptyStateComponent, ErrorStateComponent, LoadingStateComponent, PageHeadComponent, StatusBadgeComponent, StatusTone } from '../../../shared/ui';
import { ConfirmService } from '../../../shared/confirm-dialog/confirm-dialog';
import { filingTypeLabel } from '../../filings/filing-labels';
import { errorMessage } from '../../onboarding/onboarding.types';

import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
type Kind = 'request' | 'runFiling';
interface ApprovalItem {
  id: string; kind: Kind; requestId: string; employeeId: string | null; employeeName: string; employeeNumber: string;
  officeId: string; officeName: string; requestType: string; filingType: string | null; source: 'employee' | 'santei' | 'bonus' | null;
  parentId: string | null; filingId: string | null; year: number | null; payMonth: string | null; personCount: number;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'; requestedBy: string | null; requestedByName: string; requestedAt: string | null;
  reviewedAt: string | null; comment: string | null; targetVersion: number; deadline: string | null; deadlineNote: string | null;
  summary: string; mine: boolean; canApprove: boolean; overdue: boolean; dueSoon: boolean; stale: boolean;
}
interface SearchResult { items: ApprovalItem[]; total: number; summary: { pending: number; forMe: number; overdue: number; stale: number; mine: number; elsewhere: number }; staleDays: number }
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
  rejected: { label: '差戻し', tone: 'attention' }, cancelled: { label: '承認取消', tone: 'attention' },
};

/**
 * 横断の承認（docs/ui-unification-design.md の4章：左右に分けた受信箱の形）。左に一覧、右に選んだものの中身と承認・差し戻し。
 * 届出・給与・保険料・等級・雇用条件と、算定基礎届・賞与支払届の承認をまとめて扱う
 */
@Component({
  selector: 'app-approval-list',
  standalone: true,
  imports: [MatFormFieldModule, MatInputModule, MatSelectModule,
    DatePipe, FormsModule, RouterLink, MatButtonModule, MatCheckboxModule, MatIconModule,
    StatusBadgeComponent, LoadingStateComponent, ErrorStateComponent, EmptyStateComponent, PageHeadComponent,
  ],
  template: `
    <div class="app-page wide">
      <app-page-head heading="承認">
        @if (summary(); as s) {
          <ng-container meta>
            @if (canApproveRole) { <span>あなたが承認できる <b>{{ s.forMe }}件</b></span> }
            <span>承認待ち <b>{{ s.pending }}件</b></span>
            @if (s.overdue) { <span class="due-over">届出の期限超過 {{ s.overdue }}件</span> }
          </ng-container>
        }
        <ng-container actions>
          <button mat-stroked-button type="button" (click)="load()" [disabled]="loading()"><mat-icon>refresh</mat-icon>読み込み直す</button>
        </ng-container>
      </app-page-head>

      @if (officeSelected()) {
        @if (allOffices()) {
          <p class="office-note" role="status">上で事業所を選んでいますが、すべての事業所の承認を表示しています。
            <button mat-button type="button" (click)="setAllOffices(false)">選んだ事業所だけに戻す</button></p>
        } @else if (summary()?.elsewhere) {
          <p class="office-note" role="status">ほかの事業所にも承認待ちが{{ summary()!.elsewhere }}件あります（上で選んだ事業所の分だけを表示しています）。
            <button mat-button type="button" (click)="setAllOffices(true)">すべての事業所を表示</button></p>
        }
      }

      <section class="panel">
        <div class="tabs" role="tablist">
          @if (canApproveRole) {
            <button type="button" role="tab" [class.on]="tab() === 'forMe'" (click)="setTab('forMe')">あなたの承認待ち <span class="badge">{{ summary()?.forMe ?? 0 }}</span></button>
          }
          <button type="button" role="tab" [class.on]="tab() === 'mine'" (click)="setTab('mine')">あなたが依頼中 <span class="badge">{{ summary()?.mine ?? 0 }}</span></button>
          <button type="button" role="tab" [class.on]="tab() === 'all'" (click)="setTab('all')">すべての承認待ち <span class="badge">{{ summary()?.pending ?? 0 }}</span></button>
          <button type="button" role="tab" [class.on]="tab() === 'processed'" (click)="setTab('processed')">処理済み</button>
        </div>

        <div class="toolbar">
          <input class="search" type="search" [(ngModel)]="keyword" (keydown.enter)="load()" placeholder="氏名・内容で探す（Enter）" aria-label="氏名・内容で探す">
          <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-select [(ngModel)]="requestType" (ngModelChange)="load()" aria-label="種類">
            <mat-option value="">すべての種類</mat-option>
            @for (t of types; track t[0]) { <mat-option [value]="t[0]">{{ t[1] }}</mat-option> }
          </mat-select></mat-form-field>
          @if (view === 'pending') {
            <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-select [(ngModel)]="sort" (ngModelChange)="load()" aria-label="並べ方">
              <mat-option value="deadline">届出の期限の近い順</mat-option>
              <mat-option value="requestedAt">依頼の古い順</mat-option>
              <mat-option value="office">事業所の順</mat-option>
            </mat-select></mat-form-field>
          }
          <span class="grow"></span>
          @if (view === 'pending' && summary(); as s) {
            <div class="chips">
              <button type="button" class="chip" [class.on]="only === 'overdue'" (click)="toggleOnly('overdue')">期限超過 <span class="n">{{ s.overdue }}</span></button>
              <button type="button" class="chip" [class.on]="only === 'stale'" (click)="toggleOnly('stale')">{{ staleDays() }}日以上止まっている <span class="n">{{ s.stale }}</span></button>
            </div>
          }
        </div>

        @if (failures().length) {
          <div class="alert" role="alert">
            <strong>承認できなかったものがあります（{{ failures().length }}件）</strong>
            <ul>@for (f of failures(); track $index) { <li>{{ f }}</li> }</ul>
          </div>
        }

        @if (loading() && !items().length) {
          <app-loading-state message="承認の一覧を読み込んでいます…" />
        } @else if (error()) {
          <app-error-state [message]="error()" (retry)="load()" />
        } @else if (!items().length) {
          <app-empty-state [message]="view === 'pending' ? '承認待ちはありません' : '処理済みの承認はありません'" icon="task_alt" />
        } @else {
          <div class="inbox">
            <!-- 左：一覧 -->
            <div class="inbox-list" role="listbox" aria-label="承認の一覧">
              @if (view === 'pending' && approvable().length) {
                <div class="bulk">
                  <mat-checkbox [checked]="allSelected()" [indeterminate]="selected().size > 0 && !allSelected()" (change)="toggleAll($event.checked)">
                    承認できる{{ approvable().length }}件を選ぶ
                  </mat-checkbox>
                  @if (selected().size) {
                    <button mat-flat-button type="button" [disabled]="busy()" (click)="approveSelected()">選んだ{{ selected().size }}件を承認する</button>
                  }
                </div>
              }
              @for (i of items(); track i.id) {
                <div class="req" role="option" [class.on]="openId() === i.id" [attr.aria-selected]="openId() === i.id" tabindex="0"
                     (click)="select(i)" (keydown.enter)="select(i)">
                  @if (view === 'pending') {
                    <mat-checkbox [checked]="selected().has(i.id)" [disabled]="!i.canApprove" (change)="toggle(i, $event.checked)" (click)="$event.stopPropagation()"
                      [attr.aria-label]="targetLabel(i) + 'を選ぶ'" />
                  }
                  <div class="req-main">
                    <div class="top">
                      <span class="tag">{{ typeLabel(i) }}</span>
                      @if (i.deadline) { <span class="due" [class.over]="i.overdue" [class.soon]="i.dueSoon">期限 {{ i.deadline }}</span> }
                      @else if (i.deadlineNote) { <span class="due">{{ i.deadlineNote }}</span> }
                    </div>
                    <b>{{ targetLabel(i) }}</b>
                    @if (i.summary) { <div class="sub">{{ i.summary }}</div> }
                    <div class="sub">依頼：{{ i.requestedByName || '—' }}・{{ i.requestedAt | date:'M/d H:mm' }}@if (i.stale) {・<span class="stale">{{ staleDays() }}日以上止まっている</span>}</div>
                  </div>
                  <app-status-badge [tone]="toneOf(i)" [label]="labelOf(i)" />
                </div>
              }
              @if (total() > items().length) { <p class="count">先頭の{{ items().length }}件を表示しています（全{{ total() }}件）</p> }
            </div>

            <!-- 右：中身 -->
            <div class="detail">
              @if (current(); as i) {
                <div class="detail-head">
                  <div class="kicker"><span class="tag">{{ typeLabel(i) }}</span>{{ i.officeName }}</div>
                  <h2>{{ targetLabel(i) }}</h2>
                  <div class="meta">依頼：{{ i.requestedByName || '—' }}（{{ i.requestedAt | date:'M/d H:mm' }}）
                    @if (i.deadline) {・届出の期限 {{ i.deadline }}} @else if (i.deadlineNote) {・届出の期限 {{ i.deadlineNote }}}
                    @if (i.reviewedAt) {・処理 {{ i.reviewedAt | date:'M/d H:mm' }}}
                  </div>
                  @if (i.summary) { <p class="summary">{{ i.summary }}</p> }
                  @if (i.comment && i.status !== 'pending') { <p class="sub">コメント：{{ i.comment }}</p> }
                </div>
                <div class="detail-body">
                  @if (detailLoading()) { <app-loading-state message="中身を読み込んでいます…" /> }
                  @else if (detail(); as d) {
                    @if (d.tampered) { <div class="alert" role="alert">承認したあとに届出の内容が書き換えられています。送信・提出はできません。承認を取り消して確かめ直してください。</div> }
                    @if (d.changedSinceRequest) { <div class="alert" role="alert">承認を依頼したあとに対象が変わっています。承認はできないので、差し戻して依頼し直してもらってください。</div> }
                    <div class="section-title">前回の版との違い</div>
                    @if (d.note) { <p class="sub">{{ d.note }}</p> }
                    @else if (!d.previous) { <p class="sub">前回の版はありません（初めての依頼です）。</p> }
                    @else if (!d.diff.length) { <p class="sub">前回（{{ statusOf2(d.previous.status) }}{{ d.previous.comment ? '：' + d.previous.comment : '' }}）から内容は変わっていません。</p> }
                    @else {
                      <p class="sub">前回（{{ statusOf2(d.previous.status) }}{{ d.previous.comment ? '：' + d.previous.comment : '' }}）から変わった項目です。</p>
                      <table class="diff">
                        <thead><tr><th>項目</th><th>前回</th><th>今回</th></tr></thead>
                        <tbody>@for (r of d.diff; track r.field) { <tr><th>{{ r.field }}</th><td class="before">{{ r.before || '（空欄）' }}</td><td class="after">{{ r.after || '（空欄）' }}</td></tr> }</tbody>
                      </table>
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
                    @if (linkOf(i); as l) { <p class="links"><a [routerLink]="l.path" [queryParams]="l.query">{{ l.label }}</a></p> }
                  }
                </div>
                <div class="detail-foot">
                  @if (act(); as a) {
                    @if (a.kind === 'reject' || a.kind === 'cancel') {
                      <div class="reason">
                        <input type="text" [(ngModel)]="note" [placeholder]="a.kind === 'reject' ? '差し戻す理由（依頼した人に届きます）' : '承認を取り消す理由'" [attr.aria-label]="a.kind === 'reject' ? '差し戻す理由' : '取り消す理由'">
                        <button mat-button type="button" (click)="act.set(null)" [disabled]="busy()">やめる</button>
                        <button mat-flat-button type="button" (click)="runReason(a)" [disabled]="busy() || !note.trim()">{{ a.kind === 'reject' ? '差し戻す' : '承認を取り消す' }}</button>
                      </div>
                    }
                  } @else {
                    <span class="notice">{{ footNote(i) }}</span>
                    <div class="right">
                      @if (i.canApprove) {
                        <button mat-stroked-button type="button" (click)="ask({ kind: 'reject', item: i })" [disabled]="busy()">差し戻す</button>
                        <button mat-flat-button type="button" (click)="approveOne(i)" [disabled]="busy() || detail()?.changedSinceRequest">承認する</button>
                      }
                      @if (i.status === 'approved' && i.requestType === 'filing') {
                        <button mat-stroked-button type="button" (click)="ask({ kind: 'cancel', item: i })" [disabled]="busy()">承認を取り消す</button>
                      }
                    </div>
                  }
                </div>
              } @else {
                <app-empty-state message="左の一覧から選ぶと、中身がここに出ます" icon="fact_check" />
              }
            </div>
          </div>
        }
      </section>
    </div>
  `,
  styles: [`
    .wide { max-width: none; }
    .office-note { margin: 0 0 var(--app-space-3); padding: var(--app-space-2) var(--app-space-3); border-radius: var(--app-radius); background: var(--app-status-attention-bg); font-size: var(--app-font-sm); }
    .panel { border: 1px solid var(--app-color-border); border-radius: var(--app-radius); background: var(--app-color-surface); }
    .tabs { display: flex; gap: var(--app-space-5); padding: 0 var(--app-space-5); border-bottom: 1px solid var(--app-color-border); flex-wrap: wrap; }
    .tabs button { border: 0; background: none; padding: 12px 0 10px; margin-bottom: -1px; font: inherit; font-weight: 600; color: var(--app-color-text-sub); border-bottom: 2px solid transparent; cursor: pointer; display: inline-flex; gap: 6px; align-items: center; }
    .tabs button.on { color: var(--app-color-text); border-bottom-color: var(--app-status-yours-fg); }
    .badge { font-size: 11px; padding: 0 6px; border-radius: 10px; background: var(--app-status-waiting-bg); }
    .toolbar { display: flex; align-items: center; gap: var(--app-space-2); flex-wrap: wrap; padding: var(--app-space-3) var(--app-space-5); border-bottom: 1px solid var(--app-color-border); }
    .toolbar select, .search { padding: 7px 10px; border: 1px solid var(--app-color-border); border-radius: var(--app-radius); font: inherit; font-size: var(--app-font-sm); background: var(--app-color-surface); }
    .search { min-width: 220px; }
    .grow { flex: 1; }
    .chips { display: flex; gap: var(--app-space-2); }
    .chip { display: inline-flex; gap: 6px; align-items: center; padding: 4px 12px; border: 1px solid var(--app-color-border); border-radius: var(--app-radius-pill); background: var(--app-color-surface); font: inherit; font-size: var(--app-font-xs); font-weight: 600; color: var(--app-color-text-sub); cursor: pointer; }
    .chip .n { color: var(--app-status-attention-fg); }
    .chip.on { background: #273447; border-color: #273447; color: #fff; }
    .chip.on .n { color: #fff; }
    .alert { margin: var(--app-space-3) var(--app-space-5); padding: var(--app-space-3) var(--app-space-4); border-radius: var(--app-radius); background: var(--app-status-error-bg); font-size: var(--app-font-sm); }
    .detail .alert { margin: 0 0 var(--app-space-3); }

    .inbox { display: grid; grid-template-columns: minmax(300px, 380px) 1fr; min-height: 480px; }
    @media (max-width: 900px) { .inbox { grid-template-columns: 1fr; } }
    .inbox-list { border-right: 1px solid var(--app-color-border); max-height: calc(100vh - 300px); overflow: auto; }
    .bulk { display: flex; flex-wrap: wrap; gap: var(--app-space-2); align-items: center; justify-content: space-between; padding: var(--app-space-2) var(--app-space-3); background: var(--app-color-surface-sub); border-bottom: 1px solid var(--app-color-border); font-size: var(--app-font-sm); }
    .req { display: flex; gap: var(--app-space-2); align-items: flex-start; padding: var(--app-space-3); border-bottom: 1px solid var(--app-color-border); cursor: pointer; }
    .req:hover { background: #fafbfd; }
    .req.on { background: var(--app-status-yours-bg); box-shadow: inset 3px 0 0 var(--app-status-yours-fg); }
    .req:focus-visible { outline: 2px solid var(--app-color-link); outline-offset: -2px; }
    .req-main { flex: 1; min-width: 0; }
    .req-main b { display: block; font-weight: 600; margin-top: 2px; }
    .top { display: flex; gap: var(--app-space-2); align-items: center; flex-wrap: wrap; }
    .tag { font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 4px; background: var(--app-status-waiting-bg); color: var(--app-color-text-sub); }
    .due { font-size: var(--app-font-xs); color: var(--app-color-text-sub); }
    .due.soon { color: var(--app-status-attention-fg); font-weight: 700; }
    .due.over { color: var(--app-status-error-fg); font-weight: 700; }
    .sub { font-size: var(--app-font-xs); color: var(--app-color-text-sub); margin: 2px 0 0; line-height: 1.6; }
    .stale { color: var(--app-status-attention-fg); }
    .count { padding: var(--app-space-2) var(--app-space-3); font-size: var(--app-font-xs); color: var(--app-color-text-sub); }

    .detail { display: flex; flex-direction: column; min-width: 0; }
    .detail-head { padding: var(--app-space-4) var(--app-space-5) var(--app-space-3); border-bottom: 1px solid var(--app-color-border); }
    .kicker { display: flex; gap: var(--app-space-2); align-items: center; font-size: var(--app-font-xs); color: var(--app-color-text-sub); }
    .detail-head h2 { margin: 4px 0 2px; font-size: 18px; font-weight: 600; }
    .meta { font-size: var(--app-font-xs); color: var(--app-color-text-sub); }
    .summary { margin: var(--app-space-2) 0 0; }
    .detail-body { flex: 1; padding: var(--app-space-4) var(--app-space-5); overflow: auto; font-size: var(--app-font-sm); }
    .section-title { font-size: var(--app-font-xs); font-weight: 700; color: var(--app-color-text-sub); letter-spacing: .04em; margin-bottom: var(--app-space-2); }
    .diff { border-collapse: collapse; font-size: var(--app-font-sm); margin-bottom: var(--app-space-2); }
    .diff th, .diff td { padding: 4px 10px; border-bottom: 1px solid var(--app-color-border); text-align: left; }
    .diff thead th { color: var(--app-color-text-sub); font-weight: 500; }
    .diff td.before { color: var(--app-color-text-sub); text-decoration: line-through; }
    .diff td.after { background: var(--app-status-attention-bg); font-weight: 600; }
    details { margin-top: var(--app-space-3); }
    summary { cursor: pointer; color: var(--app-color-link); }
    .content { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 4px var(--app-space-4); }
    .content dt { color: var(--app-color-text-sub); font-size: var(--app-font-xs); }
    .content dd { margin: 0; word-break: break-all; }
    .history { padding-left: var(--app-space-5); }
    .links { margin: var(--app-space-3) 0 0; }
    .links a { color: var(--app-color-link); }
    .detail-foot { display: flex; align-items: center; gap: var(--app-space-3); flex-wrap: wrap; padding: var(--app-space-3) var(--app-space-5); border-top: 1px solid var(--app-color-border); background: var(--app-color-surface-sub); border-radius: 0 0 var(--app-radius) 0; }
    .notice { font-size: var(--app-font-xs); color: var(--app-color-text-sub); }
    .right { margin-left: auto; display: flex; gap: var(--app-space-2); }
    .reason { display: flex; gap: var(--app-space-2); align-items: center; flex: 1; flex-wrap: wrap; }
    .reason input { flex: 1; min-width: 240px; padding: 7px 10px; border: 1px solid var(--app-color-border); border-radius: var(--app-radius); font: inherit; font-size: var(--app-font-sm); }
  `],

})
export class ApprovalListComponent {
  private office = inject(OfficeContextService);
  private functions = inject(Functions);
  private snackBar = inject(MatSnackBar);
  private auth = inject(AuthService);
  private badge = inject(ApprovalBadgeService);
  private confirm = inject(ConfirmService);

  items = signal<ApprovalItem[]>([]);
  total = signal(0);
  summary = signal<SearchResult['summary'] | null>(null);
  /** 上部で選んだ事業所に関係なく、すべての事業所の承認を出す */
  allOffices = signal(false);
  private handled = new Map<string, number>();
  officeSelected = () => !!this.office.params().officeId;
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

  /** タブ：あなたの承認待ち／あなたが依頼中／すべての承認待ち／処理済み */
  tab = signal<'forMe' | 'mine' | 'all' | 'processed'>('all');
  /** 右に中身を出している承認 */
  current = computed(() => this.items().find(i => i.id === this.openId()) ?? null);

  constructor() {
    if (this.canApproveRole) { this.only = 'forMe'; this.tab.set('forMe'); }
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
    if (i.kind === 'runFiling') return i.filingType === 'bonusNonPayment' ? `事業所の報告（${i.payMonth}分）` : `${i.personCount}名分`;
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

  setAllOffices(on: boolean) {
    this.allOffices.set(on);
    void this.load();
  }

  setTab(t: 'forMe' | 'mine' | 'all' | 'processed') {
    this.tab.set(t);
    this.view = t === 'processed' ? 'processed' : 'pending';
    this.only = t === 'forMe' || t === 'mine' ? t : '';
    this.openId.set(null);
    void this.load();
  }

  /** 期限超過・止まっているの絞り込み（もう一度押すとタブの絞り込みに戻る） */
  toggleOnly(o: 'overdue' | 'stale') {
    const base = this.tab() === 'forMe' || this.tab() === 'mine' ? this.tab() as 'forMe' | 'mine' : '';
    this.only = this.only === o ? base : o;
    void this.load();
  }

  toneOf(i: ApprovalItem): StatusTone {
    if (i.status === 'pending') return i.canApprove ? 'yours' : 'waiting';
    return this.statusOf(i).tone;
  }
  labelOf(i: ApprovalItem) {
    if (i.status === 'pending') return i.canApprove ? 'あなたの番' : i.mine ? '自分の依頼' : '承認待ち';
    return this.statusOf(i).label;
  }
  /** 右下の注意の1行（押す前に知っておくべきこと） */
  footNote(i: ApprovalItem) {
    if (i.canApprove) return i.requestType === 'filing' || i.kind === 'runFiling' ? '承認すると、届出を提出できる状態になります。' : '承認すると確定し、差し戻さないと直せません。';
    if (i.status === 'pending' && i.mine) return '自分の依頼は自分では承認できません。ほかの承認者が承認します。';
    if (i.status === 'approved' && i.requestType === 'filing') return '提出の前なら、承認を取り消して下書きに戻せます。';
    return '';
  }

  select(i: ApprovalItem) {
    if (this.openId() === i.id) return;
    this.act.set(null);
    void this.toggleDetail(i);
  }

  async approveOne(i: ApprovalItem) {
    const ok = await this.confirm.ask({
      title: `${this.typeLabel(i)}を承認する`, message: `${this.targetLabel(i)}${i.summary ? `（${i.summary}）` : ''}を承認します。`,
      notice: this.footNote(i), confirmLabel: '承認する',
    });
    if (ok) { this.note = ''; await this.run({ kind: 'approve', item: i }); }
  }

  async approveSelected() {
    const list = this.selectedItems();
    const ok = await this.confirm.ask({
      title: 'まとめて承認する', count: `${list.length}件`, message: '次の承認をまとめて行います。内容を確かめてから承認してください。',
      items: list.map(i => `${this.typeLabel(i)}：${this.targetLabel(i)}${i.summary ? `（${i.summary}）` : ''}`), confirmLabel: `${list.length}件を承認する`,
    });
    if (ok) { this.note = ''; await this.run({ kind: 'bulk' }); }
  }

  /** 差し戻し・承認取消（理由を入れてから） */
  runReason(a: Act) {
    return this.run(a);
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
    const handled: string[] = [];
    try {
      if (a.kind === 'bulk' || a.kind === 'approve') {
        const list = a.kind === 'bulk' ? this.selectedItems() : [a.item];
        const { data } = await httpsCallable<object, { approved: number; results: { ok: boolean; message: string | null }[] }>(
          this.functions, 'approvalBulkApprove', { timeout: 540_000 },
        )({ companyId, items: list.map(i => this.target(i)), ...(this.note.trim() ? { comment: this.note.trim() } : {}) });
        const failed = data.results.map((r, n) => (r.ok ? null : `${this.typeLabel(list[n])}（${this.targetLabel(list[n])}）：${r.message}`)).filter((x): x is string => !!x);
        this.failures.set(failed);
        this.snackBar.open(`${data.approved}件を承認しました${failed.length ? `（${failed.length}件はできませんでした）` : ''}`, '閉じる', { duration: 5000 });
        data.results.forEach((r, n) => { if (r.ok) handled.push(list[n].id); });
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
        handled.push(i.id);
      } else {
        await httpsCallable(this.functions, 'approvalCancel')({ companyId, target: this.target(a.item), reason: this.note.trim() });
        this.snackBar.open('承認を取り消し、下書きに戻しました', '閉じる', { duration: 4000 });
      }
      this.act.set(null);
      this.openId.set(null);
      // 一覧は承認の索引を読む。索引はトリガーが少しあとに直すので、処理した案件は先に画面から外し、少し待って読み直す
      for (const id of handled) this.handled.set(id, Date.now() + 30_000);
      await this.load();
      setTimeout(() => void this.load(), 3000);
      void this.badge.refresh();
      setTimeout(() => void this.badge.refresh(), 3000);
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
        companyId: this.auth.companyId, ...(this.allOffices() ? {} : this.office.params()), view: this.view,
        ...(this.only ? { only: this.only } : {}), ...(this.requestType ? { requestType: this.requestType } : {}),
        ...(this.keyword.trim() ? { keyword: this.keyword.trim() } : {}), ...(this.view === 'pending' ? { sort: this.sort } : {}),
      });
      const now = Date.now();
      for (const [id, until] of this.handled) if (until < now) this.handled.delete(id);
      // 処理したばかりの案件は、索引が追いつくまで承認待ちに出さない
      this.items.set(this.view === 'pending' ? data.items.filter(i => !this.handled.has(i.id)) : data.items);
      this.total.set(data.total);
      this.summary.set(data.summary);
      this.staleDays.set(data.staleDays);
      const ids = new Set(data.items.map(i => i.id));
      this.selected.set(new Set([...this.selected()].filter(id => ids.has(id))));
      const shown = this.items();
      if (shown.length && !shown.some(i => i.id === this.openId())) void this.toggleDetail(shown[0]);
    } catch (e) {
      this.error.set(errorMessage(e, '承認の一覧を読み込めませんでした'));
    } finally {
      this.loading.set(false);
    }
  }
}
