import { Component, inject, signal, OnInit } from '@angular/core';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../../core/services/auth.service';
import { OfficeContextService } from '../../../core/services/office-context.service';
import { EmptyStateComponent, ErrorStateComponent, LoadingStateComponent, StatusBadgeComponent } from '../../../shared/ui';
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

/** 届出の横断一覧。3か所の届出（従業員の下・算定基礎届・賞与支払届）を索引から探す */
@Component({
  selector: 'app-filing-list',
  standalone: true,
  imports: [
    FormsModule, RouterLink, MatButtonModule, MatIconModule, MatFormFieldModule, MatSelectModule, MatInputModule,
    StatusBadgeComponent, LoadingStateComponent, ErrorStateComponent, EmptyStateComponent,
  ],
  template: `
    <div class="page">
      <header class="head">
        <div>
          <h1>届出</h1>
          <p class="sub">すべての届出を、期限の近い順に表示します。新しい届出は手続きの中で作ります。</p>
        </div>
        <a mat-stroked-button routerLink="/procedures/new"><mat-icon>add</mat-icon> 手続きを始める</a>
      </header>

      @if (summary(); as s) {
        <div class="cards" role="group" aria-label="届出の状況">
          <button type="button" class="card" [class.on]="view === 'open'" (click)="setView('open')">
            <span class="num">{{ s.open }}</span><span>まだ提出していない</span>
          </button>
          <button type="button" class="card warn" [class.on]="view === 'overdue'" (click)="setView('overdue')">
            <span class="num">{{ s.overdue }}</span><span>期限を過ぎている</span>
          </button>
          <button type="button" class="card" [class.on]="view === 'dueSoon'" (click)="setView('dueSoon')">
            <span class="num">{{ s.dueSoon }}</span><span>今週が期限（7日以内）</span>
          </button>
          <button type="button" class="card" [class.on]="status === 'pending'" (click)="setStatus('pending')">
            <span class="num">{{ s.pending }}</span><span>承認待ち</span>
          </button>
        </div>
      }

      <form class="filters" (ngSubmit)="search()">
        <mat-form-field appearance="outline">
          <mat-label>表示</mat-label>
          <mat-select name="view" [(ngModel)]="view" (selectionChange)="search()">
            <mat-option value="all">すべて</mat-option>
            <mat-option value="open">まだ提出していない</mat-option>
            <mat-option value="overdue">期限を過ぎている</mat-option>
            <mat-option value="dueSoon">今週が期限</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>届出の種類</mat-label>
          <mat-select name="type" [(ngModel)]="filingType" (selectionChange)="search()">
            <mat-option value="">すべて</mat-option>
            @for (t of types; track t[0]) { <mat-option [value]="t[0]">{{ t[1] }}</mat-option> }
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>状態</mat-label>
          <mat-select name="status" [(ngModel)]="status" (selectionChange)="search()">
            <mat-option value="">すべて</mat-option>
            @for (s of statuses; track s[0]) { <mat-option [value]="s[0]">{{ s[1] }}</mat-option> }
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>紙の提出</mat-label>
          <mat-select name="paper" [(ngModel)]="paperStatus" (selectionChange)="search()">
            <mat-option value="">すべて</mat-option>
            <mat-option value="none">紙では出していない</mat-option>
            <mat-option value="submitted">紙で提出済み</mat-option>
            <mat-option value="accepted">紙で受理</mat-option>
            <mat-option value="returned">紙で返戻</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>氏名・社員番号</mat-label>
          <input matInput name="keyword" [(ngModel)]="keyword">
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>受付番号</mat-label>
          <input matInput name="acceptance" [(ngModel)]="acceptanceNumber" placeholder="MOCK-…">
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>期間の基準</mat-label>
          <mat-select name="base" [(ngModel)]="periodBase">
            <mat-option value="created">作成日</mat-option>
            <mat-option value="submitted">提出日</mat-option>
            <mat-option value="deadline">期限</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>から</mat-label>
          <input matInput type="date" name="from" [(ngModel)]="from">
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>まで</mat-label>
          <input matInput type="date" name="to" [(ngModel)]="to">
        </mat-form-field>
        <div class="filter-actions">
          <button mat-flat-button color="primary" type="submit"><mat-icon>search</mat-icon> 探す</button>
          <button mat-button type="button" (click)="clear()">条件を消す</button>
        </div>
      </form>

      <details class="zip" [open]="zipOpen()" (toggle)="zipOpen.set($any($event.target).open)">
        <summary>PDFをまとめて保存する（ZIP）</summary>
        <p class="sub">承認した届出の保存原本（承認した時点の内容）から公式様式のPDFを作り、ZIPにまとめます。上の「届出の種類」と事業所の選択も使います。</p>
        <div class="zip-row">
          <mat-form-field appearance="outline">
            <mat-label>期間の基準</mat-label>
            <mat-select [(ngModel)]="zipBase" name="zipBase">
              <mat-option value="submitted">提出日</mat-option>
              <mat-option value="created">作成日</mat-option>
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline"><mat-label>から</mat-label><input matInput type="date" [(ngModel)]="zipFrom" name="zipFrom"></mat-form-field>
          <mat-form-field appearance="outline"><mat-label>まで</mat-label><input matInput type="date" [(ngModel)]="zipTo" name="zipTo"></mat-form-field>
          <button mat-flat-button type="button" (click)="makeZip()" [disabled]="zipBusy() || !zipFrom || !zipTo">ZIPを作る</button>
        </div>
        @if (zipStatus()) { <p role="status">{{ zipStatus() }}</p> }
        @if (zipWarnings().length) {
          <details><summary>確かめてほしいこと（{{ zipWarnings().length }}件）</summary><ul>@for (w of zipWarnings(); track $index) { <li>{{ w }}</li> }</ul></details>
        }
        @if (zipUrl(); as z) { <a mat-stroked-button [href]="z.url" [download]="z.name"><mat-icon>download</mat-icon>{{ z.name }} を保存する</a> }
      </details>

      @if (employeeId) {
        <p class="note">従業員を絞り込んでいます。<button mat-button type="button" (click)="clearEmployee()">すべての従業員を表示</button></p>
      }

      @if (loading()) {
        <app-loading-state message="届出を読み込んでいます…" />
      } @else if (error()) {
        <app-error-state [message]="error()" (retry)="search()" />
      } @else if (!rows().length) {
        <app-empty-state message="条件に合う届出はありません" hint="条件を変えるか、「条件を消す」を押してください" icon="description" />
      } @else {
        <p class="count" role="status">
          {{ total() }}件{{ total() > rows().length ? '（先頭の' + rows().length + '件を表示）' : '' }}
          @if (truncated()) { <span class="warn-text">件数が多いため一部だけを探しました。条件を絞ってください。</span> }
        </p>
        <div class="table-wrap">
          <table class="list">
            <thead>
              <tr><th>期限</th><th>届出</th><th>対象</th><th>事業所</th><th>状態</th><th>紙の提出</th><th>受付番号</th><th>作成日</th></tr>
            </thead>
            <tbody>
              @for (r of rows(); track r.id) {
                <tr [class.overdue]="r.overdue" (click)="open(r)" tabindex="0" (keydown.enter)="open(r)">
                  <td class="nowrap">
                    @if (r.deadline) {
                      {{ r.deadline }}
                      @if (r.overdue) { <span class="badge-overdue">期限超過</span> }
                    } @else { <span class="muted">{{ r.deadlineNote ?? '—' }}</span> }
                  </td>
                  <td><a class="link">{{ typeLabel(r.filingType) }}</a>@if (r.number) { <span class="muted">（{{ r.number }}件目）</span> }</td>
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
        </div>
      }
    </div>
  `,
  styles: [`
    .page { padding: var(--app-space-5); max-width: 1280px; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--app-space-4); flex-wrap: wrap; margin-bottom: var(--app-space-4); }
    h1 { margin: 0; font-size: 24px; font-weight: 500; }
    .sub { margin: var(--app-space-1) 0 0; color: var(--app-color-text-sub); }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: var(--app-space-3); margin: var(--app-space-5) 0 var(--app-space-4); }
    .card { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: var(--app-space-3) var(--app-space-4); border: 1px solid var(--app-color-border);
      border-radius: 8px; background: var(--app-color-surface); cursor: pointer; font: inherit; color: var(--app-color-text); text-align: left; }
    .card .num { font-size: 24px; font-weight: 600; }
    .card.warn .num { color: var(--app-status-action-fg); }
    .card.on { border-color: var(--app-color-link); box-shadow: 0 0 0 1px var(--app-color-link) inset; }
    .filters { display: flex; flex-wrap: wrap; gap: 0 var(--app-space-3); align-items: center; }
    .filters mat-form-field { width: 180px; }
    .filter-actions { display: flex; gap: var(--app-space-2); margin-bottom: 20px; }
    .note { color: var(--app-color-text-sub); }
    .zip { margin: 0 0 var(--app-space-4); padding: var(--app-space-2) var(--app-space-3); border: 1px solid var(--app-color-border); border-radius: 8px; background: var(--app-color-surface); }
    .zip summary { cursor: pointer; color: var(--app-color-link); }
    .zip-row { display: flex; flex-wrap: wrap; gap: 0 var(--app-space-3); align-items: center; }
    .zip-row mat-form-field { width: 180px; }
    .count { color: var(--app-color-text-sub); margin: 0 0 var(--app-space-2); }
    .warn-text { color: var(--app-status-action-fg); margin-left: var(--app-space-2); }
    .table-wrap { overflow-x: auto; border: 1px solid var(--app-color-border); border-radius: 8px; background: var(--app-color-surface); }
    .list { width: 100%; border-collapse: collapse; font-size: 14px; }
    .list th { text-align: left; font-weight: 500; color: var(--app-color-text-sub); background: var(--app-color-surface-sub); }
    .list th, .list td { padding: var(--app-space-2) var(--app-space-3); border-bottom: 1px solid var(--app-color-border); }
    .list tbody tr { cursor: pointer; }
    .list tbody tr:hover, .list tbody tr:focus { background: var(--app-color-surface-sub); outline: none; }
    .list tr.overdue td:first-child { color: var(--app-status-action-fg); font-weight: 500; }
    .badge-overdue { display: inline-block; margin-left: var(--app-space-1); padding: 0 6px; border-radius: 10px; font-size: 12px;
      color: var(--app-status-action-fg); background: var(--app-status-action-bg); }
    .nowrap { white-space: nowrap; }
    .muted { color: var(--app-color-text-sub); font-size: 12px; }
    .link { color: var(--app-color-link); }
    @media (max-width: 600px) {
      .page { padding: var(--app-space-4); }
      .filters mat-form-field { width: 100%; }
    }
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
    this.view = this.view === view ? 'all' : view;
    this.status = '';
    this.search();
  }

  setStatus(status: string) {
    this.status = this.status === status ? '' : status;
    this.view = 'all';
    this.search();
  }

  clear() {
    this.view = 'all';
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
