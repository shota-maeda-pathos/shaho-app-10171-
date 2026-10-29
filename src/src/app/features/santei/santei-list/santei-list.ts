import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../../core/services/auth.service';
import { OfficeContextService } from '../../../core/services/office-context.service';
import {
  defaultSanteiYear, SANTEI_STATUS_LABELS, SanteiPreviewResponse, SanteiRow, SanteiStatus, SanteiSubmitResult,
} from '../santei.types';

type Filter = 'all' | 'attention' | 'ok' | 'excluded';

@Component({
  selector: 'app-santei-list',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatButtonModule, MatIconModule, MatCardModule, MatTableModule, MatButtonToggleModule,
    MatProgressSpinnerModule, MatSnackBarModule,
  ],
  template: `
    <div class="page-container">
      <div class="page-header">
        <h1>算定基礎届</h1>
        <label class="year-select">対象年
          <select [ngModel]="targetYear()" (ngModelChange)="changeYear($event)" aria-label="対象年">
            @for (y of years; track y) { <option [ngValue]="y">{{ y }}年</option> }
          </select>
        </label>
      </div>

      <p class="guide">
        4〜6月に支払った承認済みの給与から、9月分以降の標準報酬月額を決めます。届出期間は
        {{ period().from | date:'M月d日' }}〜{{ period().to | date:'M月d日' }}です。
        平均・等級はシステムが計算します。保留・対応要の人を確認してから、対象者をまとめて承認申請してください。
      </p>

      <div class="summary-cards">
        @for (card of summary(); track card.key) {
          <mat-card class="summary-card" [class.active]="filter() === card.filter" (click)="filter.set(card.filter)">
            <div class="summary-label">{{ card.label }}</div>
            <div class="summary-value" [attr.data-tone]="card.tone">{{ card.count }} 名</div>
          </mat-card>
        }
      </div>

      @if (error()) {
        <p role="alert" class="error">{{ error() }}</p>
        <button mat-stroked-button (click)="reload()">再読み込み</button>
      }

      <mat-card>
        <mat-button-toggle-group [value]="filter()" (change)="filter.set($event.value)" aria-label="表示する人">
          <mat-button-toggle value="all">すべて</mat-button-toggle>
          <mat-button-toggle value="attention">要確認（保留・対応要）</mat-button-toggle>
          <mat-button-toggle value="ok">対象</mat-button-toggle>
          <mat-button-toggle value="excluded">除外</mat-button-toggle>
        </mat-button-toggle-group>

        <table mat-table [dataSource]="visibleRows()" class="full-width-table">
          <ng-container matColumnDef="employeeName">
            <th mat-header-cell *matHeaderCellDef>従業員</th>
            <td mat-cell *matCellDef="let row">
              <a class="link" (click)="viewDetail(row.employeeId)">{{ row.employeeName }}</a>
              <div class="sub">{{ row.employeeNumber }}</div>
            </td>
          </ng-container>
          <ng-container matColumnDef="months">
            <th mat-header-cell *matHeaderCellDef>4〜6月（報酬・支払基礎日数）</th>
            <td mat-cell *matCellDef="let row">
              @for (m of row.months; track m.yearMonth) {
                <div class="month" [class.unused]="isCalculated(row) && !m.used">
                  {{ +m.yearMonth.slice(5) }}月：
                  @if (m.remuneration !== null) { {{ m.remuneration | number }}円・{{ m.paymentBasisDays }}日 } @else { 未登録 }
                </div>
              }
            </td>
          </ng-container>
          <ng-container matColumnDef="average">
            <th mat-header-cell *matHeaderCellDef class="text-right">平均</th>
            <td mat-cell *matCellDef="let row" class="text-right bold">{{ row.average === null ? '—' : (row.average | number) }}</td>
          </ng-container>
          <ng-container matColumnDef="health">
            <th mat-header-cell *matHeaderCellDef>健保等級</th>
            <td mat-cell *matCellDef="let row">{{ gradeText(row, 'health') }}</td>
          </ng-container>
          <ng-container matColumnDef="pension">
            <th mat-header-cell *matHeaderCellDef>厚年等級</th>
            <td mat-cell *matCellDef="let row">{{ gradeText(row, 'pension') }}</td>
          </ng-container>
          <ng-container matColumnDef="status">
            <th mat-header-cell *matHeaderCellDef>状態</th>
            <td mat-cell *matCellDef="let row">
              <span class="status-chip" [attr.data-status]="row.status">{{ statusLabel(row.status) }}</span>
              @if (row.status === 'ok' && row.changed) { <span class="status-chip" data-status="changed">変更あり</span> }
              @if (row.approvalStatus !== 'none') { <span class="status-chip" data-status="submitted">{{ row.approvalStatus === 'pending' ? '承認待ち' : '承認済み' }}</span> }
              <div class="sub">{{ row.reason }}</div>
              @if (failures()[row.employeeId]; as message) { <div class="error">{{ message }}</div> }
            </td>
          </ng-container>
          <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
          <tr mat-row *matRowDef="let row; columns: displayedColumns" [class.highlight]="row.status === 'ok' && row.changed"></tr>
        </table>

        @if (loading()) {
          <div class="loading-container"><mat-spinner diameter="32"></mat-spinner></div>
        } @else if (rows().length === 0 && !error()) {
          <div class="empty-state">
            <mat-icon>assessment</mat-icon>
            <p>この事業所に算定基礎届の対象者はいません</p>
          </div>
        }
        @if (hasMore() && !loading()) {
          <div class="more"><button mat-stroked-button (click)="loadMore()">さらに読み込む</button>
            <span class="sub">読み込み済み {{ rows().length }} 名。集計は読み込み済みの人数です</span></div>
        }
      </mat-card>

      @if (submittable().length > 0) {
        <div class="action-bar">
          <span>承認申請できる人：{{ submittable().length }} 名（等級が変わらない人も定時決定として申請します）</span>
          <button mat-flat-button color="primary" (click)="submitAll()" [disabled]="submitting()">
            <mat-icon>send</mat-icon> {{ submitting() ? '申請中…' : 'まとめて承認申請' }}
          </button>
        </div>
      }
    </div>
  `,
  styles: [`
    .page-container { padding: 24px; }
    .page-header { display: flex; align-items: center; gap: 16px; margin-bottom: 8px; }
    .page-header h1 { margin: 0; font-size: 24px; font-weight: 500; }
    .year-select select { margin-left: 8px; padding: 6px 8px; }
    .guide { color: #555; line-height: 1.7; margin: 0 0 16px; max-width: 900px; }
    .summary-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 16px; }
    .summary-card { padding: 12px 16px; cursor: pointer; }
    .summary-card.active { outline: 2px solid #1976d2; }
    .summary-label { font-size: 12px; color: #666; }
    .summary-value { font-size: 22px; font-weight: 600; margin-top: 4px; }
    .summary-value[data-tone="warn"] { color: #c62828; }
    .summary-value[data-tone="accent"] { color: #e65100; }
    mat-button-toggle-group { margin: 8px 0 12px; }
    .full-width-table { width: 100%; }
    .text-right { text-align: right; }
    .bold { font-weight: 600; }
    .sub { font-size: 12px; color: #666; margin-top: 2px; }
    .month { font-size: 13px; white-space: nowrap; }
    .month.unused { color: #9e9e9e; text-decoration: line-through; }
    .link { color: #1976d2; cursor: pointer; }
    .status-chip { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 12px; background: #f5f5f5; margin-right: 4px; }
    .status-chip[data-status="ok"] { background: #e8f5e9; color: #2e7d32; }
    .status-chip[data-status="pending"], .status-chip[data-status="needsAction"] { background: #ffebee; color: #c62828; }
    .status-chip[data-status="changed"] { background: #fff3e0; color: #e65100; }
    .status-chip[data-status="submitted"] { background: #e3f2fd; color: #1565c0; }
    .highlight { background: #fff8e1; }
    .error { color: #c62828; font-size: 13px; }
    .loading-container { display: flex; justify-content: center; padding: 24px; }
    .empty-state { text-align: center; padding: 48px; color: #666; }
    .empty-state mat-icon { font-size: 48px; width: 48px; height: 48px; color: #ccc; }
    .more { display: flex; align-items: center; gap: 12px; padding: 12px 0; }
    .action-bar { display: flex; justify-content: flex-end; align-items: center; gap: 16px; margin-top: 16px; }
  `],
})
export class SanteiListComponent implements OnInit {
  office = inject(OfficeContextService);
  private router = inject(Router);
  private functions = inject(Functions);
  private snackBar = inject(MatSnackBar);
  private auth = inject(AuthService);

  readonly years = (() => { const y = new Date().getFullYear(); return [y, y - 1, y - 2]; })();
  targetYear = signal(defaultSanteiYear());
  rows = signal<SanteiRow[]>([]);
  period = signal({ from: `${defaultSanteiYear()}-07-01`, to: `${defaultSanteiYear()}-07-10` });
  loading = signal(false);
  submitting = signal(false);
  hasMore = signal(false);
  error = signal('');
  filter = signal<Filter>('all');
  failures = signal<Record<string, string>>({});
  private cursor: string | undefined;
  private requestSeq = 0;

  displayedColumns = ['employeeName', 'months', 'average', 'health', 'pension', 'status'];

  count = (statuses: SanteiStatus[]) => this.rows().filter(r => statuses.includes(r.status)).length;
  summary = computed(() => [
    { key: 'ok', label: '対象', count: this.count(['ok']), filter: 'ok' as Filter, tone: '' },
    { key: 'changed', label: 'うち等級変更あり', count: this.rows().filter(r => r.status === 'ok' && r.changed).length, filter: 'ok' as Filter, tone: 'accent' },
    { key: 'attention', label: '保留・対応要', count: this.count(['pending', 'needsAction']), filter: 'attention' as Filter, tone: 'warn' },
    { key: 'excluded', label: '除外', count: this.count(['excluded']), filter: 'excluded' as Filter, tone: '' },
  ]);
  visibleRows = computed(() => {
    const f = this.filter();
    if (f === 'all') return this.rows();
    if (f === 'attention') return this.rows().filter(r => r.status === 'pending' || r.status === 'needsAction');
    return this.rows().filter(r => r.status === f);
  });
  submittable = computed(() => this.rows().filter(r => r.status === 'ok' && r.approvalStatus === 'none'));

  ngOnInit() {
    void this.reload();
  }

  /** 平均を計算した行か（保留・除外の行は月の使用・不使用を表示しない） */
  isCalculated(row: SanteiRow) {
    return row.status === 'ok' || row.status === 'needsAction';
  }

  statusLabel(status: SanteiStatus) {
    return SANTEI_STATUS_LABELS[status];
  }

  gradeText(row: SanteiRow, kind: 'health' | 'pension') {
    const key = kind === 'health' ? 'healthGradeNumber' : 'pensionGradeNumber';
    const current = row.current?.[key];
    const proposed = row.proposed?.[key];
    if (proposed === undefined) return current === undefined ? '—' : `${current}`;
    return current === undefined || current === proposed ? `${proposed}` : `${current} → ${proposed}`;
  }

  changeYear(year: number) {
    this.targetYear.set(year);
    void this.reload();
  }

  viewDetail(employeeId: string) {
    void this.router.navigate(['/santei', employeeId], { queryParams: { year: this.targetYear(), ...this.office.queryParams() } });
  }

  async reload() {
    this.cursor = undefined;
    this.rows.set([]);
    this.failures.set({});
    await this.load();
  }

  async loadMore() {
    await this.load();
  }

  private async load() {
    const seq = ++this.requestSeq;
    this.loading.set(true);
    this.error.set('');
    try {
      const { data } = await httpsCallable<object, SanteiPreviewResponse>(this.functions, 'santeiPreview')({
        companyId: this.auth.companyId, year: this.targetYear(), ...this.office.params(), limit: 50,
        ...(this.cursor ? { lastDocId: this.cursor } : {}),
      });
      if (seq !== this.requestSeq) return;
      this.rows.update(rows => [...rows, ...data.items]);
      this.period.set(data.filingPeriod);
      this.hasMore.set(data.hasMore);
      this.cursor = data.lastDocId;
    } catch (e: unknown) {
      if (seq === this.requestSeq) this.error.set(e instanceof Error ? e.message : '算定の対象者を取得できませんでした');
    } finally {
      if (seq === this.requestSeq) this.loading.set(false);
    }
  }

  async submitAll() {
    const targets = this.submittable().map(r => r.employeeId);
    this.submitting.set(true);
    const failures: Record<string, string> = {};
    let ok = 0;
    try {
      // サーバーの上限（1回100名）に合わせて分けて送る
      for (let i = 0; i < targets.length; i += 100) {
        const { data } = await httpsCallable<object, { results: SanteiSubmitResult[] }>(this.functions, 'santeiSubmit')({
          companyId: this.auth.companyId, year: this.targetYear(), employeeIds: targets.slice(i, i + 100),
        });
        for (const r of data.results) {
          if (r.ok) ok++;
          else failures[r.employeeId] = r.error ?? '申請できませんでした';
        }
      }
    } catch (e: unknown) {
      this.snackBar.open(`申請を中断しました：${e instanceof Error ? e.message : ''}（${ok}名は申請済み）`, '閉じる', { duration: 6000 });
    } finally {
      this.submitting.set(false);
    }
    const failed = Object.keys(failures).length;
    this.snackBar.open(failed ? `${ok}名を承認申請しました。${failed}名は申請できませんでした（一覧に理由を表示）` : `${ok}名を承認申請しました`, '閉じる', { duration: 5000 });
    await this.reload();
    this.failures.set(failures);
  }
}
