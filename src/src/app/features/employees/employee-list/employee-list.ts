import { Component, inject, signal, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../../core/services/auth.service';
import { CsvImportDialogComponent } from '../csv-import-dialog/csv-import-dialog';

interface Employee {
  id: string;
  employeeNumber: string;
  lastName: string;
  firstName: string;
  lastNameKana: string;
  firstNameKana: string;
  officeId: string;
  hireDate: string;
  resignationDate: string | null;
}

@Component({
  selector: 'app-employee-list',
  standalone: true,
  imports: [
    MatTableModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatProgressSpinnerModule,
    MatChipsModule, MatSnackBarModule,
  ],
  template: `
    <div class="page-header">
      <h1>従業員一覧</h1>
      <div class="header-actions">
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
      </div>
    </div>

    @if (loading()) {
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

        <ng-container matColumnDef="hireDate">
          <th mat-header-cell *matHeaderCellDef>入社日</th>
          <td mat-cell *matCellDef="let e">{{ e.hireDate }}</td>
        </ng-container>

        <ng-container matColumnDef="status">
          <th mat-header-cell *matHeaderCellDef>状態</th>
          <td mat-cell *matCellDef="let e">
            @if (e.resignationDate) {
              <mat-chip-set>
                <mat-chip color="warn" highlighted>退職済</mat-chip>
              </mat-chip-set>
            } @else {
              <mat-chip-set>
                <mat-chip color="primary" highlighted>在籍</mat-chip>
              </mat-chip-set>
            }
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
          <p>従業員が登録されていません</p>
        </div>
      }

      @if (hasMore()) {
        <div class="load-more">
          <button mat-stroked-button (click)="loadMore()">
            さらに読み込む
          </button>
        </div>
      }
    }
  `,
  styles: [`
    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
    }
    h1 { margin: 0; font-size: 24px; }
    .header-actions { display: flex; gap: 8px; }
    .employee-table { width: 100%; }
    .clickable-row { cursor: pointer; }
    .clickable-row:hover { background: rgba(0, 0, 0, 0.04); }
    .loading { display: flex; justify-content: center; padding: 48px; }
    .empty-state {
      text-align: center;
      padding: 48px;
      color: rgba(0, 0, 0, 0.54);
      mat-icon { font-size: 48px; width: 48px; height: 48px; }
    }
    .load-more { text-align: center; margin-top: 16px; }
  `],
})
export class EmployeeListComponent implements OnInit {
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

  displayedColumns = ['employeeNumber', 'name', 'nameKana', 'hireDate', 'status'];

  ngOnInit() {
    this.loadEmployees();
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
      });
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
