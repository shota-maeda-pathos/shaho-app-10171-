import { Component, inject, signal, OnInit } from '@angular/core';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../../core/services/auth.service';
import { OfficeContextService } from '../../../core/services/office-context.service';
import { EmptyStateComponent, ErrorStateComponent, LoadingStateComponent, PageHeadComponent, StatusBadgeComponent } from '../../../shared/ui';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import {
  FILING_STATUS_LABELS, FILING_TYPE_LABELS, FilingStatus, filingTone, filingTypeLabel, PAPER_STATUS_LABELS, PaperStatus,
} from '../filing-labels';

interface FilingRow {
  id: string;
  source: 'employee' | 'santei' | 'bonus';
  filingId: string;
  parentId: string;
  employeeId: string | null;
  employeeName: string;
  employeeNumber: string;
  personCount: number;
  officeId: string;
  officeName: string;
  filingType: string;
  number: number | null;
  year: number | null;
  payMonth: string | null;
  status: FilingStatus;
  paperStatus: PaperStatus;
  open: boolean;
  overdue: boolean;
  deadline: string | null;
  deadlineNote: string | null;
  acceptanceNumber: string | null;
  createdDate: string | null;
  submittedDate: string | null;
}

interface SearchResponse {
  items: FilingRow[];
  total: number;
  truncated: boolean;
  summary: { open: number; overdue: number; dueSoon: number; pending: number };
  today: string;
}

type View = 'all' | 'open' | 'overdue' | 'dueSoon';

/** 届出の横断一覧。3か所の届出（従業員の下・算定基礎届・賞与支払届）を索引から探す。よく使う絞り込みはタブ、それ以外は「条件を足す」 */
@Component({
  selector: 'app-filing-list',
  standalone: true,
  imports: [MatDatepickerModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    FormsModule, RouterLink, MatButtonModule, MatIconModule,
    StatusBadgeComponent, LoadingStateComponent, ErrorStateComponent, EmptyStateComponent, PageHeadComponent,
  ],
  template: `
    <div class="app-page">
      <app-page-head heading="届出">
        @if (summary(); as s) {
          <ng-container meta>
            <span>未提出 <b>{{ s.open }}件</b></span>
            @if (s.overdue) { <span class="due-over">期限超過 {{ s.overdue }}件</span> }
            @if (s.dueSoon) { <span class="due-soon">7日以内 {{ s.dueSoon }}件</span> }
            <span>承認待ち {{ s.pending }}件</span>
          </ng-container>
        }
        <ng-container actions>
          <button mat-stroked-button type="button" (click)="zipOpen.set(!zipOpen())"><mat-icon>folder_zip</mat-icon>PDFをまとめて保存（ZIP）</button>
          <a mat-stroked-button routerLink="/procedures/new"><mat-icon>add</mat-icon>手続きを始める</a>
        </ng-container>
      </app-page-head>

      @if (zipOpen()) {
        <section class="zip">
          <p class="sub">承認した届出の保存原本（承認した時点の内容）から公式様式のPDFを作り、ZIPにまとめます。下の「届出の種類」と上の事業所の選択も使います。</p>
          <div class="zip-row">
            <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-select [(ngModel)]="zipBase" name="zipBase" aria-label="期間の基準">
              <mat-option value="submitted">提出日</mat-option>
              <mat-option value="created">作成日</mat-option>
            </mat-select></mat-form-field>
            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="date-field"><input matInput [(ngModel)]="zipFrom" name="zipFrom" aria-label="から" [matDatepicker]="dp1" placeholder="YYYY/MM/DD"><mat-datepicker-toggle matIconSuffix [for]="dp1" /><mat-datepicker #dp1 /></mat-form-field> 〜
            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="date-field"><input matInput [(ngModel)]="zipTo" name="zipTo" aria-label="まで" [matDatepicker]="dp2" placeholder="YYYY/MM/DD"><mat-datepicker-toggle matIconSuffix [for]="dp2" /><mat-datepicker #dp2 /></mat-form-field>
            <button mat-flat-button type="button" (click)="makeZip()" [disabled]="zipBusy() || !zipFrom || !zipTo">ZIPを作る</button>
          </div>
          @if (zipStatus()) { <p role="status">{{ zipStatus() }}</p> }
          @if (zipWarnings().length) {
            <details><summary>確かめてほしいこと（{{ zipWarnings().length }}件）</summary><ul>@for (w of zipWarnings(); track $index) { <li>{{ w }}</li> }</ul></details>
          }
          @if (zipUrl(); as z) { <a mat-stroked-button [href]="z.url" [download]="z.name"><mat-icon>download</mat-icon>{{ z.name }} を保存する</a> }
        </section>
      }

      <section class="panel">
        <div class="tabs" role="tablist">
          <button type="button" role="tab" [class.on]="view === 'open' && !status" (click)="setView('open')">まだ提出していない <span class="badge">{{ summary()?.open ?? 0 }}</span></button>
          <button type="button" role="tab" [class.on]="view === 'overdue' && !status" (click)="setView('overdue')">期限超過 <span class="badge warn">{{ summary()?.overdue ?? 0 }}</span></button>
          <button type="button" role="tab" [class.on]="view === 'dueSoon' && !status" (click)="setView('dueSoon')">7日以内 <span class="badge">{{ summary()?.dueSoon ?? 0 }}</span></button>
          <button type="button" role="tab" [class.on]="status === 'pending'" (click)="setStatus('pending')">承認待ち <span class="badge">{{ summary()?.pending ?? 0 }}</span></button>
          <button type="button" role="tab" [class.on]="view === 'all' && !status" (click)="setView('all')">すべて</button>
        </div>

        <form class="toolbar" (ngSubmit)="search()">
          <input name="keyword" [(ngModel)]="keyword" placeholder="氏名・社員番号で探す（Enter）" aria-label="氏名・社員番号">
          <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-select name="type" [(ngModel)]="filingType" (ngModelChange)="search()" aria-label="届出の種類">
            <mat-option value="">すべての届出</mat-option>
            @for (t of types; track t[0]) { <mat-option [value]="t[0]">{{ t[1] }}</mat-option> }
          </mat-select></mat-form-field>
          <button mat-button type="button" (click)="moreFilters.set(!moreFilters())">{{ moreFilters() ? '条件を閉じる' : '条件を足す' }}</button>
          @if (hasFilters()) { <button mat-button type="button" (click)="clear()">条件を消す</button> }
          @if (moreFilters()) {
            <div class="more">
              <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-select name="status" [(ngModel)]="status" (ngModelChange)="search()" aria-label="状態">
                <mat-option value="">すべての状態</mat-option>
                @for (s of statuses; track s[0]) { <mat-option [value]="s[0]">{{ s[1] }}</mat-option> }
              </mat-select></mat-form-field>
              <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-select name="paper" [(ngModel)]="paperStatus" (ngModelChange)="search()" aria-label="紙の提出">
                <mat-option value="">紙の提出：すべて</mat-option>
                <mat-option value="none">紙では出していない</mat-option>
                <mat-option value="submitted">紙で提出済み</mat-option>
                <mat-option value="accepted">紙で受理</mat-option>
                <mat-option value="returned">紙で返戻</mat-option>
              </mat-select></mat-form-field>
              <input name="acceptance" [(ngModel)]="acceptanceNumber" placeholder="受付番号（MOCK-…）" aria-label="受付番号">
              <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-select name="base" [(ngModel)]="periodBase" aria-label="期間の基準">
                <mat-option value="created">作成日</mat-option>
                <mat-option value="submitted">提出日</mat-option>
                <mat-option value="deadline">期限</mat-option>
              </mat-select></mat-form-field>
              <mat-form-field appearance="outline" subscriptSizing="dynamic" class="date-field"><input matInput name="from" [(ngModel)]="from" aria-label="から" [matDatepicker]="dp3" placeholder="YYYY/MM/DD"><mat-datepicker-toggle matIconSuffix [for]="dp3" /><mat-datepicker #dp3 /></mat-form-field> 〜
              <mat-form-field appearance="outline" subscriptSizing="dynamic" class="date-field"><input matInput name="to" [(ngModel)]="to" aria-label="まで" [matDatepicker]="dp4" placeholder="YYYY/MM/DD"><mat-datepicker-toggle matIconSuffix [for]="dp4" /><mat-datepicker #dp4 /></mat-form-field>
              <button mat-stroked-button type="submit"><mat-icon>search</mat-icon>探す</button>
            </div>
          }
        </form>

        @if (employeeId) {
          <p class="note">従業員を絞り込んでいます。<button mat-button type="button" (click)="clearEmployee()">すべての従業員を表示</button></p>
        }

        @if (loading()) {
          <app-loading-state message="届出を読み込んでいます…" />
        } @else if (error()) {
          <app-error-state [message]="error()" (retry)="search()" />
        } @else if (!rows().length) {
          <app-empty-state message="条件に合う届出はありません" hint="タブや条件を変えてください" icon="description" />
        } @else {
          <table class="list">
            <thead>
              <tr><th>期限</th><th>届出</th><th>対象</th><th>事業所</th><th>状態</th><th>紙の提出</th><th>受付番号</th><th>作成日</th></tr>
            </thead>
            <tbody>
              @for (r of rows(); track r.id) {
                <tr (click)="open(r)" tabindex="0" (keydown.enter)="open(r)">
                  <td class="nowrap">
                    @if (r.deadline) { <span [class.due-over]="r.overdue">{{ r.deadline }}</span> }
                    @else { <span class="muted">{{ r.deadlineNote ?? '—' }}</span> }
                  </td>
                  <td><b>{{ typeLabel(r.filingType) }}</b>@if (r.number) { <span class="muted">（{{ r.number }}件目）</span> }</td>
                  <td>
                    @if (r.source === 'employee') { {{ r.employeeName }} <span class="muted">{{ r.employeeNumber }}</span> }
                    @else if (r.filingType === 'bonusNonPayment') { 事業所の報告 <span class="muted">{{ r.payMonth }}分</span> }
                    @else { {{ r.personCount }}名 <span class="muted">{{ r.year ? r.year + '年' : r.payMonth + '支給' }}</span> }
                  </td>
                  <td>{{ r.officeName }}</td>
                  <td><app-status-badge [tone]="tone(r)" [label]="statusLabel(r.status)" /></td>
                  <td>{{ paperLabel(r.paperStatus) }}</td>
                  <td class="nowrap">{{ r.acceptanceNumber ?? '' }}</td>
                  <td class="nowrap">{{ r.createdDate ?? '' }}</td>
                </tr>
              }
            </tbody>
          </table>
          <p class="foot">
            {{ total() }}件{{ total() > rows().length ? '（先頭の' + rows().length + '件を表示）' : '' }}
            @if (truncated()) { <span class="due-over">件数が多いため一部だけを探しました。条件を絞ってください。</span> }
            ・新しい届出は手続きの中で作ります。
          </p>
        }
      </section>
    </div>
  `,
  styles: [`
    .due-over { color: var(--app-status-error-fg); font-weight: 700; }
    .due-soon { color: var(--app-status-attention-fg); font-weight: 700; }
    .zip { margin-bottom: var(--app-space-4); padding: var(--app-space-3) var(--app-space-4); border: 1px solid var(--app-color-border); border-radius: var(--app-radius); background: var(--app-color-surface); font-size: var(--app-font-sm); }
    .zip-row { display: flex; flex-wrap: wrap; gap: var(--app-space-2); align-items: center; margin: var(--app-space-2) 0; }
    .panel { border: 1px solid var(--app-color-border); border-radius: var(--app-radius); background: var(--app-color-surface); }
    .tabs { display: flex; gap: var(--app-space-5); padding: 0 var(--app-space-5); border-bottom: 1px solid var(--app-color-border); flex-wrap: wrap; }
    .tabs button { border: 0; background: none; padding: 12px 0 10px; margin-bottom: -1px; font: inherit; font-weight: 600; color: var(--app-color-text-sub); border-bottom: 2px solid transparent; cursor: pointer; display: inline-flex; gap: 6px; align-items: center; }
    .tabs button.on { color: var(--app-color-text); border-bottom-color: var(--app-status-yours-fg); }
    .badge { font-size: 11px; padding: 0 6px; border-radius: 10px; background: var(--app-status-waiting-bg); }
    .badge.warn { color: var(--app-status-error-fg); background: var(--app-status-error-bg); }
    .toolbar { display: flex; flex-wrap: wrap; gap: var(--app-space-2); align-items: center; padding: var(--app-space-3) var(--app-space-5); border-bottom: 1px solid var(--app-color-border); }
    .toolbar input, .toolbar select, .zip-row input, .zip-row select { padding: 7px 10px; border: 1px solid var(--app-color-border); border-radius: var(--app-radius); font: inherit; font-size: var(--app-font-sm); background: var(--app-color-surface); }
    .toolbar > input { min-width: 220px; }
    .more { display: flex; flex-wrap: wrap; gap: var(--app-space-2); align-items: center; width: 100%; }
    .note { margin: 0; padding: var(--app-space-2) var(--app-space-5); color: var(--app-color-text-sub); font-size: var(--app-font-sm); }
    .sub { margin: 0; color: var(--app-color-text-sub); }
    .list { width: 100%; border-collapse: collapse; font-size: var(--app-font-md); }
    .list th { text-align: left; font-size: var(--app-font-xs); font-weight: 600; color: var(--app-color-text-sub); background: var(--app-color-surface-sub); white-space: nowrap; }
    .list th, .list td { padding: var(--app-space-2) var(--app-space-3); border-bottom: 1px solid var(--app-color-border); }
    .list th:first-child, .list td:first-child { padding-left: var(--app-space-5); }
    .list b { font-weight: 600; }
    .list tbody tr { cursor: pointer; }
    .list tbody tr:hover td { background: #fafbfd; }
    .list tbody tr:focus-visible { outline: 2px solid var(--app-color-link); outline-offset: -2px; }
    .nowrap { white-space: nowrap; }
    .muted { color: var(--app-color-text-sub); font-size: var(--app-font-xs); }
    .foot { margin: 0; padding: var(--app-space-3) var(--app-space-5); font-size: var(--app-font-xs); color: var(--app-color-text-sub); }
  `],

})
export class FilingListComponent implements OnInit {
  private office = inject(OfficeContextService);
  private functions = inject(Functions);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private auth = inject(AuthService);

  rows = signal<FilingRow[]>([]);
  total = signal(0);
  truncated = signal(false);
  summary = signal<SearchResponse['summary'] | null>(null);
  loading = signal(false);
  error = signal('');

  types = Object.entries(FILING_TYPE_LABELS);
  statuses = Object.entries(FILING_STATUS_LABELS);

  view: View = 'open';
  filingType = '';
  status = '';
  paperStatus = '';
  keyword = '';
  acceptanceNumber = '';
  periodBase: 'created' | 'submitted' | 'deadline' = 'created';
  from = '';
  to = '';
  employeeId = '';

  /** 「条件を足す」を開いているか */
  moreFilters = signal(false);
  hasFilters() { return !!(this.filingType || this.status || this.paperStatus || this.keyword || this.acceptanceNumber || this.from || this.to); }

  // ---- ZIP でまとめて保存 ----
  zipOpen = signal(false);
  zipBusy = signal(false);
  zipStatus = signal('');
  zipWarnings = signal<string[]>([]);
  zipUrl = signal<{ url: string; name: string } | null>(null);
  zipBase: 'submitted' | 'created' = 'submitted';
  zipFrom = '';
  zipTo = '';

  async makeZip() {
    const old = this.zipUrl();
    if (old) URL.revokeObjectURL(old.url);
    this.zipUrl.set(null);
    this.zipWarnings.set([]);
    this.zipBusy.set(true);
    try {
      const [{ pdfFromArchive, archiveFileName }, { createZip, uniqueNames }] = await Promise.all([import('../archive/archive-pdf'), import('../archive/zip')]);
      const call = httpsCallable<object, { items: any[]; total: number; truncated: boolean }>(this.functions, 'filingArchiveBatch', { timeout: 120_000 });
      const files: { name: string; data: Uint8Array }[] = [];
      const warnings: string[] = [];
      let offset = 0;
      let total = 0;
      let current = 0;
      do {
        const { data } = await call({
          companyId: this.auth.companyId, ...this.office.params(), ...(this.filingType ? { filingType: this.filingType } : {}),
          base: this.zipBase, from: this.zipFrom, to: this.zipTo, offset, limit: 20,
        });
        total = data.total;
        if (data.truncated) warnings.push('届出が多いため、一部だけを探しました。期間や種類を絞ってください。');
        for (const item of data.items) {
          this.zipStatus.set(`PDFを作っています（${files.length + 1}/${total}件）…`);
          const name = archiveFileName(item);
          try {
            const pdf = await pdfFromArchive(item.archive);
            files.push({ name, data: pdf.bytes });
            if (item.current) current += 1;
            for (const w of pdf.warnings) warnings.push(`${name}：${w}`);
          } catch (e) {
            warnings.push(`${name}：PDFを作れませんでした（${e instanceof Error ? e.message : e}）`);
          }
        }
        offset += data.items.length;
        if (!data.items.length) break;
      } while (offset < total);
      if (!files.length) { this.zipStatus.set('条件に合う承認済みの届出はありません。'); return; }
      const names = uniqueNames(files.map(f => f.name));
      const zip = createZip(files.map((f, i) => ({ name: names[i], data: f.data })));
      const name = `届出PDF_${this.zipFrom}_${this.zipTo}.zip`;
      this.zipUrl.set({ url: URL.createObjectURL(new Blob([zip as unknown as BlobPart], { type: 'application/zip' })), name });
      this.zipStatus.set(`${files.length}件のPDFをZIPにまとめました（${(zip.length / 1024 / 1024).toFixed(1)}MB）${current ? `。うち${current}件は保存原本がないため、今の内容から作りました（ファイル名の末尾が「今の内容」）` : ''}。`);
      this.zipWarnings.set(warnings);
    } catch (e: unknown) {
      this.zipStatus.set(e instanceof Error ? e.message : 'ZIPを作れませんでした');
    } finally {
      this.zipBusy.set(false);
    }
  }

  ngOnInit() {
    const q = this.route.snapshot.queryParamMap;
    this.employeeId = q.get('employeeId') ?? '';
    this.view = (q.get('view') as View) ?? (this.employeeId ? 'all' : 'open');
    this.filingType = q.get('type') ?? '';
    this.status = q.get('status') ?? '';
    this.search();
  }

  setView(view: View) {
    this.view = view;
    this.status = '';
    this.search();
  }

  setStatus(status: string) {
    this.status = status;
    this.view = 'all';
    this.search();
  }

  /** タブはそのままにして、条件だけ消す */
  clear() {
    this.filingType = this.status = this.paperStatus = this.keyword = this.acceptanceNumber = this.from = this.to = '';
    this.search();
  }

  clearEmployee() {
    this.employeeId = '';
    this.router.navigate([], { queryParams: {} });
    this.search();
  }

  async search() {
    this.loading.set(true);
    this.error.set('');
    try {
      const fn = httpsCallable<object, SearchResponse>(this.functions, 'filingSearch');
      const { data } = await fn({
        companyId: this.auth.companyId,
        ...this.office.params(),
        ...(this.employeeId ? { employeeId: this.employeeId } : {}),
        view: this.view,
        ...(this.filingType ? { filingType: this.filingType } : {}),
        ...(this.status ? { status: this.status } : {}),
        ...(this.paperStatus ? { paperStatus: this.paperStatus } : {}),
        ...(this.keyword.trim() ? { keyword: this.keyword.trim() } : {}),
        ...(this.acceptanceNumber.trim() ? { acceptanceNumber: this.acceptanceNumber.trim() } : {}),
        ...(this.from || this.to ? { period: { base: this.periodBase, ...(this.from ? { from: this.from } : {}), ...(this.to ? { to: this.to } : {}) } } : {}),
        limit: 300,
      });
      this.rows.set(data.items);
      this.total.set(data.total);
      this.truncated.set(data.truncated);
      this.summary.set(data.summary);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : '届出を読み込めませんでした');
    } finally {
      this.loading.set(false);
    }
  }

  /** 届出の画面へ。算定基礎届・賞与支払届は一括型の画面で扱う */
  open(r: FilingRow) {
    if (r.source === 'santei') this.router.navigate(['/santei'], { queryParams: { officeId: r.officeId, year: r.year } });
    else if (r.source === 'bonus') this.router.navigate(['/bonus'], { queryParams: { officeId: r.officeId, month: r.payMonth } });
    else this.router.navigate(['/filings', r.filingId], { queryParams: { employeeId: r.employeeId } });
  }

  typeLabel = filingTypeLabel;
  statusLabel = (s: FilingStatus) => FILING_STATUS_LABELS[s] ?? s;
  paperLabel = (s: PaperStatus) => PAPER_STATUS_LABELS[s] ?? s;
  tone = (r: FilingRow) => filingTone(r.status, r.paperStatus);
}
