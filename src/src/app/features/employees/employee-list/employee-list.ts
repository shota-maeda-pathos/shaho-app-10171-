import { Component, inject, signal, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatSelectModule } from '@angular/material/select';
import { FormsModule } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../../core/services/auth.service';
import { OfficeContextService } from '../../../core/services/office-context.service';
import { PageHeadComponent } from '../../../shared/ui';
import { CsvImportDialogComponent } from '../csv-import-dialog/csv-import-dialog';

interface Employee {
  id: string;
  employeeNumber: string;
  lastName: string;
  firstName: string;
  lastNameKana: string;
  firstNameKana: string;
  officeId: string;
  departmentId?: string | null;
  hireDate: string;
  resignationDate: string | null;
  employmentType?: string | null;
  employmentStatus?: string;
}

const STATUS_LABELS: Record<string, string> = {
  active: '在籍中', sickLeave: '休職中', maternityLeave: '産前産後休業中', childcareLeave: '育児休業中', careLeave: '介護休業中', resigned: '退職済み',
};

const EMPLOYMENT_TYPE_LABELS: Record<string, string> = {
  regular: '正社員', contract: '契約社員', partTime: 'パート', arbeit: 'アルバイト', executiveFull: '役員（常勤）', executivePart: '役員（非常勤）',
};

@Component({
  selector: 'app-employee-list',
  standalone: true,
  imports: [
    MatTableModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatProgressSpinnerModule,
    MatChipsModule, MatSnackBarModule, PageHeadComponent, MatSelectModule, FormsModule,
  ],
  template: `
    <app-page-head heading="従業員">
      <ng-container meta><span>{{ office.label() }}</span></ng-container>
      <ng-container actions>
        <button mat-stroked-button (click)="exportCsv()" [disabled]="exporting()">
          <mat-icon>download</mat-icon>
          {{ exporting() ? '出力中...' : '在籍者CSV出力' }}
        </button>
        <button mat-stroked-button (click)="openCsvImport()">
          <mat-icon>upload_file</mat-icon>
          CSV取込
        </button>
        <button mat-flat-button color="primary" (click)="onCreate()">
          <mat-icon>add</mat-icon>
          新規登録
        </button>
      </ng-container>
    </app-page-head>

    <form class="filters" (ngSubmit)="search()">
      <mat-form-field appearance="outline" subscriptSizing="dynamic" class="keyword">
        <mat-label>氏名・カナ・社員番号で探す</mat-label>
        <input matInput name="keyword" [(ngModel)]="keyword">
        <mat-icon matSuffix>search</mat-icon>
      </mat-form-field>
      <mat-form-field appearance="outline" subscriptSizing="dynamic">
        <mat-label>雇用形態</mat-label>
        <mat-select name="employmentType" [(ngModel)]="employmentType" (selectionChange)="search()">
          <mat-option value="">すべて</mat-option>
          @for (t of employmentTypes; track t[0]) { <mat-option [value]="t[0]">{{ t[1] }}</mat-option> }
        </mat-select>
      </mat-form-field>
      <mat-form-field appearance="outline" subscriptSizing="dynamic">
        <mat-label>在籍状態</mat-label>
        <mat-select name="status" [(ngModel)]="statusFilter" (selectionChange)="search()">
          <mat-option value="">退職者を除く</mat-option>
          <mat-option value="all">退職者も含める</mat-option>
          @for (s of statuses; track s[0]) { <mat-option [value]="s[0]">{{ s[1] }}</mat-option> }
        </mat-select>
      </mat-form-field>
      <button mat-stroked-button type="submit"><mat-icon>search</mat-icon> 探す</button>
      @if (total() !== null) { <span class="count" role="status">{{ total() }}名</span> }
    </form>

    <!-- 続きの読み込み中は一覧を出したままにする（消すと一覧の先頭に戻ってしまう） -->
    @if (loading() && employees().length === 0) {
      <div class="loading">
        <mat-spinner diameter="40"></mat-spinner>
      </div>
    } @else if (loadError()) {
      <p role="alert">従業員情報を取得できませんでした。</p>
      <button mat-stroked-button (click)="loadEmployees()">再読み込み</button>
    } @else {
      <table mat-table [dataSource]="employees()" class="employee-table">
        <ng-container matColumnDef="employeeNumber">
          <th mat-header-cell *matHeaderCellDef>社員番号</th>
          <td mat-cell *matCellDef="let e">{{ e.employeeNumber }}</td>
        </ng-container>

        <ng-container matColumnDef="name">
          <th mat-header-cell *matHeaderCellDef>氏名</th>
          <td mat-cell *matCellDef="let e">{{ e.lastName }} {{ e.firstName }}</td>
        </ng-container>

        <ng-container matColumnDef="nameKana">
          <th mat-header-cell *matHeaderCellDef>カナ</th>
          <td mat-cell *matCellDef="let e">{{ e.lastNameKana }} {{ e.firstNameKana }}</td>
        </ng-container>

        <ng-container matColumnDef="office">
          <th mat-header-cell *matHeaderCellDef>事業所・部署</th>
          <td mat-cell *matCellDef="let e">{{ officeName(e.officeId) }}@if (departmentName(e.departmentId); as d) {<span class="dept">{{ d }}</span>}</td>
        </ng-container>

        <ng-container matColumnDef="employmentType">
          <th mat-header-cell *matHeaderCellDef>雇用形態</th>
          <td mat-cell *matCellDef="let e">{{ typeLabel(e.employmentType) }}</td>
        </ng-container>

        <ng-container matColumnDef="hireDate">
          <th mat-header-cell *matHeaderCellDef>入社日</th>
          <td mat-cell *matCellDef="let e">{{ e.hireDate }}</td>
        </ng-container>

        <ng-container matColumnDef="status">
          <th mat-header-cell *matHeaderCellDef>状態</th>
          <td mat-cell *matCellDef="let e">
            <span class="state" [attr.data-kind]="e.employmentStatus ?? (e.resignationDate ? 'resigned' : 'active')">{{ statusLabel(e) }}</span>
          </td>
        </ng-container>

        <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
        <tr mat-row *matRowDef="let row; columns: displayedColumns"
            class="clickable-row"
            (click)="onRowClick(row)"></tr>
      </table>

      @if (employees().length === 0) {
        <div class="empty-state">
          <mat-icon>person_off</mat-icon>
          <p>{{ keyword || employmentType ? '条件に合う従業員はいません' : '従業員が登録されていません' }}</p>
        </div>
      }

      @if (hasMore()) {
        <div class="load-more">
          <button mat-stroked-button (click)="loadMore()" [disabled]="loading()">
            {{ loading() ? '読み込み中…' : 'さらに読み込む' }}
          </button>
        </div>
      }
    }
  `,
  styles: [`
    .employee-table { width: 100%; }
    .clickable-row { cursor: pointer; }
    .clickable-row:hover { background: #fafbfd; }
    .loading { display: flex; justify-content: center; padding: 48px; }
    .empty-state {
      text-align: center;
      padding: 48px;
      color: rgba(0, 0, 0, 0.54);
      mat-icon { font-size: 48px; width: 48px; height: 48px; }
    }
    .load-more { text-align: center; margin-top: 16px; }
    .filters { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-bottom: 16px; }
    .filters .keyword { width: 300px; }
    .filters mat-form-field { width: 220px; }
    .filters .count { color: var(--app-color-text-sub); }
    .dept { display: block; font-size: 12px; color: var(--app-color-text-sub); }
    .state { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 12px; background: var(--app-status-done-bg); color: var(--app-status-done-fg); }
    .state[data-kind=resigned] { background: var(--app-status-waiting-bg); color: var(--app-status-waiting-fg); }
    .state[data-kind=sickLeave], .state[data-kind=maternityLeave], .state[data-kind=childcareLeave], .state[data-kind=careLeave] { background: var(--app-status-yours-bg); color: var(--app-status-yours-fg); }
    @media (max-width: 600px) { .filters mat-form-field { width: 100%; } }
  `],
})
export class EmployeeListComponent implements OnInit {
  office = inject(OfficeContextService);
  private functions = inject(Functions);
  private router = inject(Router);
  private auth = inject(AuthService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  exporting = signal(false);
  loadError = signal(false);

  employees = signal<Employee[]>([]);
  loading = signal(true);
  hasMore = signal(false);
  private lastDocId: string | null = null;

  displayedColumns = ['employeeNumber', 'name', 'nameKana', 'office', 'employmentType', 'hireDate', 'status'];
  private departments = signal<Map<string, string>>(new Map());
  officeName = (id: string | null | undefined) => this.office.offices().find(o => o.id === id)?.name ?? '—';
  departmentName = (id: string | null | undefined) => (id ? this.departments().get(id) ?? '' : '');
  employmentTypes = Object.entries(EMPLOYMENT_TYPE_LABELS);
  keyword = '';
  employmentType = '';
  statusFilter = '';
  statuses = Object.entries(STATUS_LABELS);
  statusLabel = (e: Employee) => STATUS_LABELS[e.employmentStatus ?? (e.resignationDate ? 'resigned' : 'active')] ?? '—';
  total = signal<number | null>(null);
  typeLabel = (t: string | null | undefined) => (t ? EMPLOYMENT_TYPE_LABELS[t] ?? t : '—');

  /** 条件を変えたら1ページ目から読み直す */
  search() {
    this.employees.set([]);
    this.lastDocId = null;
    this.loading.set(false);
    void this.loadEmployees();
  }

  ngOnInit() {
    this.loadEmployees();
    httpsCallable<object, { items: { id: string; name: string }[] }>(this.functions, 'departmentList')({ companyId: this.auth.companyId, includeInactive: true })
      .then(({ data }) => this.departments.set(new Map(data.items.map(d => [d.id, d.name]))))
      .catch(() => { /* 部署名が出なくても一覧は使える */ });
  }

  async loadEmployees() {
    if (this.loading() && this.employees().length > 0) return;
    this.loading.set(true);
    this.loadError.set(false);
    try {
      const fn = httpsCallable<any, any>(this.functions, 'employeeList');
      const result = await fn({
        companyId: this.auth.companyId,
        limit: 20,
        ...(this.lastDocId ? { lastDocId: this.lastDocId } : {}),
        ...this.office.params(),
        ...(this.keyword.trim() ? { keyword: this.keyword.trim() } : {}),
        ...(this.employmentType ? { employmentType: this.employmentType } : {}),
        ...(this.statusFilter === 'all' ? { includeResigned: true } : this.statusFilter ? { status: this.statusFilter } : {}),
      });
      this.total.set(result.data.total ?? null);
      const items: Employee[] = result.data.items;
      this.hasMore.set(result.data.hasMore);
      if (items.length > 0) {
        this.lastDocId = items[items.length - 1].id;
      }
      this.employees.update((prev) => [...prev, ...items]);
    } catch (e) {
      this.loadError.set(true);
      console.error('Failed to load employees', e);
    } finally {
      this.loading.set(false);
    }
  }

  async exportCsv() {
    if (this.exporting()) return;
    this.exporting.set(true);
    try {
      const fn = httpsCallable<{ companyId: string; isActive: boolean }, { csv: string; count: number }>(this.functions, 'employeeExport');
      const { data } = await fn({ companyId: this.auth.companyId, isActive: true });
      const url = URL.createObjectURL(new Blob([data.csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `employees-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      try {
        link.click();
      } finally {
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      this.snackBar.open(`${data.count}件の在籍者をCSV出力しました`, '閉じる', { duration: 4000 });
    } catch {
      this.snackBar.open('CSV出力に失敗しました。接続状況とアクセス権を確認してください。', '閉じる', { duration: 5000 });
    } finally {
      this.exporting.set(false);
    }
  }

  loadMore() {
    this.loadEmployees();
  }

  onRowClick(employee: Employee) {
    this.router.navigate(['/employees', employee.id]);
  }

  onCreate() {
    this.router.navigate(['/employees', 'new']);
  }

  openCsvImport() {
    const ref = this.dialog.open(CsvImportDialogComponent, { width: '640px' });
    ref.afterClosed().subscribe((imported) => {
      if (imported) {
        this.employees.set([]);
        this.lastDocId = null;
        this.loadEmployees();
      }
    });
  }
}
