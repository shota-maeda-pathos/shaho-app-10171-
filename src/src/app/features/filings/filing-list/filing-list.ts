import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatInputModule } from '@angular/material/input';
import { FormsModule } from '@angular/forms';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../../core/services/auth.service';
import { OfficeContextService } from '../../../core/services/office-context.service';

interface FilingRow {
  id: string;
  employeeId: string;
  employeeName: string;
  filingType: string;
  workflowStatus: string;
  mockStatus: string;
  submissionStatus: string;
  effectiveDate: string;
}

interface EmployeeListItem {
  id: string;
  lastName: string;
  firstName: string;
  employeeNumber: string;
}

const FILING_TYPE_LABELS: Record<string, string> = {
  acquisitionNotification: '資格取得届',
  lossNotification: '資格喪失届',
  remunerationMonthlyChange: '報酬月額変更届',
  remunerationMonthlyAlgorithm: '算定基礎届',
  dependentChange: '被扶養者異動届',
  maternityLeaveStart: '産前産後休業申出書',
  childcareLeaveStart: '育児休業等申出書',
  childcareLeaveEnd: '育児休業等終了届',
  bonusPayment: '賞与支払届',
};

const WORKFLOW_LABELS: Record<string, string> = {
  draft: '下書き', pending: '承認待ち', approved: '承認済み', rejected: '差戻し',
};

const SUBMISSION_LABELS: Record<string, string> = {
  notSubmitted: '未提出', submitted: '提出済み', accepted: '受理', returned: '返戻',
};

@Component({
  selector: 'app-filing-list',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatTableModule, MatButtonModule, MatIconModule, MatCardModule,
    MatChipsModule, MatFormFieldModule, MatSelectModule, MatProgressSpinnerModule,
    MatDialogModule, MatSnackBarModule, MatInputModule,
  ],
  template: `
    <div class="page-container">
      <div class="page-header">
        <h1>届出管理</h1>
        <button mat-flat-button color="primary" (click)="openAutoGenerate()">
          <mat-icon>auto_fix_high</mat-icon> 自動生成
        </button>
      </div>

      @if (showAutoGen()) {
        <mat-card class="auto-gen-card">
          <h2>届出自動生成</h2>
          <div class="auto-gen-form">
            <mat-form-field appearance="outline">
              <mat-label>届出種別</mat-label>
              <mat-select [(ngModel)]="autoGenType">
                <mat-option value="acquisitionNotification">資格取得届</mat-option>
                <mat-option value="lossNotification">資格喪失届</mat-option>
                <mat-option value="remunerationMonthlyChange">月額変更届</mat-option>
                <mat-option value="remunerationMonthlyAlgorithm">算定基礎届</mat-option>
                <mat-option value="dependentChange">被扶養者異動届</mat-option>
                <mat-option value="bonusPayment">賞与支払届</mat-option>
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>対象従業員</mat-label>
              <mat-select [(ngModel)]="autoGenEmployeeId" [disabled]="employeesLoading() || generating()">
                @for (emp of employees(); track emp.id) {
                  <mat-option [value]="emp.id">{{ emp.number }} - {{ emp.name }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            @if (employeesLoading()) {
              <p role="status">従業員を読み込み中...</p>
            } @else if (employeesError()) {
              <div role="alert">
                <p>{{ employeesError() }}</p>
                <button mat-stroked-button (click)="loadEmployees()">従業員を再読み込み</button>
              </div>
            } @else if (employees().length === 0) {
              <p>選択できる従業員がいません。</p>
            }
            <mat-form-field appearance="outline">
              <mat-label>届出日</mat-label>
              <input matInput [(ngModel)]="autoGenDate" placeholder="2026-10-27">
            </mat-form-field>
            <div class="auto-gen-actions">
              <button mat-flat-button color="primary" (click)="executeAutoGenerate()" [disabled]="generating() || employeesLoading() || !autoGenEmployeeId || !autoGenDate">
                @if (generating()) { <mat-spinner diameter="20"></mat-spinner> }
                生成
              </button>
              <button mat-stroked-button (click)="showAutoGen.set(false)">キャンセル</button>
            </div>
          </div>
        </mat-card>
      }

      <div class="filters">
        <mat-form-field appearance="outline">
          <mat-label>承認状態</mat-label>
          <mat-select [value]="workflowFilter()" (selectionChange)="workflowFilter.set($event.value)">
            <mat-option value="all">すべて</mat-option>
            <mat-option value="draft">下書き</mat-option>
            <mat-option value="pending">承認待ち</mat-option>
            <mat-option value="approved">承認済み</mat-option>
            <mat-option value="rejected">差戻し</mat-option>
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>提出状態</mat-label>
          <mat-select [value]="submissionFilter()" (selectionChange)="submissionFilter.set($event.value)">
            <mat-option value="all">すべて</mat-option>
            <mat-option value="notSubmitted">未提出</mat-option>
            <mat-option value="submitted">提出済み</mat-option>
            <mat-option value="accepted">受理</mat-option>
            <mat-option value="returned">返戻</mat-option>
          </mat-select>
        </mat-form-field>
      </div>

      @if (loading()) {
        <div class="loading-container">
          <mat-spinner diameter="40"></mat-spinner>
        </div>
      } @else {
        <mat-card>
          <table mat-table [dataSource]="filteredFilings()" class="full-width-table">
            <ng-container matColumnDef="filingType">
              <th mat-header-cell *matHeaderCellDef>届出種別</th>
              <td mat-cell *matCellDef="let row">
                <a class="link" (click)="viewDetail(row)">{{ filingTypeLabel(row.filingType) }}</a>
              </td>
            </ng-container>

            <ng-container matColumnDef="employeeName">
              <th mat-header-cell *matHeaderCellDef>従業員</th>
              <td mat-cell *matCellDef="let row">{{ row.employeeName }}</td>
            </ng-container>

            <ng-container matColumnDef="effectiveDate">
              <th mat-header-cell *matHeaderCellDef>適用日</th>
              <td mat-cell *matCellDef="let row">{{ row.effectiveDate }}</td>
            </ng-container>

            <ng-container matColumnDef="workflowStatus">
              <th mat-header-cell *matHeaderCellDef>承認</th>
              <td mat-cell *matCellDef="let row">
                <span class="status-chip" [attr.data-status]="row.workflowStatus">
                  {{ workflowLabel(row.workflowStatus) }}
                </span>
              </td>
            </ng-container>

            <ng-container matColumnDef="submissionStatus">
              <th mat-header-cell *matHeaderCellDef>提出</th>
              <td mat-cell *matCellDef="let row">
                <span class="status-chip" [attr.data-status]="row.submissionStatus">
                  {{ submissionLabel(row.submissionStatus) }}
                </span>
              </td>
            </ng-container>

            <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
            <tr mat-row *matRowDef="let row; columns: displayedColumns"></tr>
          </table>

          @if (filteredFilings().length === 0) {
            <div class="empty-state">
              <mat-icon>description</mat-icon>
              <p>届出データがありません</p>
            </div>
          }
        </mat-card>
      }
    </div>
  `,
  styles: [`
    .page-container { padding: 24px; }
    .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .page-header h1 { margin: 0; font-size: 24px; font-weight: 500; }
    .filters { display: flex; gap: 16px; margin-bottom: 16px; }
    .filters mat-form-field { width: 160px; }
    .full-width-table { width: 100%; }
    .loading-container { display: flex; justify-content: center; padding: 48px; }
    .empty-state { text-align: center; padding: 48px; color: #666; }
    .empty-state mat-icon { font-size: 48px; width: 48px; height: 48px; color: #ccc; }
    .status-chip { padding: 4px 12px; border-radius: 16px; font-size: 12px; background: #f5f5f5; }
    .status-chip[data-status="approved"], .status-chip[data-status="accepted"] { background: #e8f5e9; color: #2e7d32; }
    .status-chip[data-status="pending"], .status-chip[data-status="submitted"] { background: #fff3e0; color: #e65100; }
    .status-chip[data-status="rejected"], .status-chip[data-status="returned"] { background: #ffebee; color: #c62828; }
    .link { color: #1976d2; cursor: pointer; text-decoration: none; }
    .link:hover { text-decoration: underline; }
    .auto-gen-card { padding: 24px; margin-bottom: 16px; }
    .auto-gen-form { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start; }
    .auto-gen-form mat-form-field { min-width: 200px; }
    .auto-gen-actions { display: flex; gap: 8px; align-items: center; padding-top: 8px; }
  `],
})
export class FilingListComponent implements OnInit {
  office = inject(OfficeContextService);
  private functions = inject(Functions);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private snackBar = inject(MatSnackBar);
  private auth = inject(AuthService);

  filings = signal<FilingRow[]>([]);
  loading = signal(false);
  workflowFilter = signal('all');
  submissionFilter = signal('all');
  showAutoGen = signal(false);
  generating = signal(false);
  employees = signal<{ id: string; name: string; number: string }[]>([]);
  employeesLoading = signal(false);
  employeesError = signal('');

  autoGenType = 'acquisitionNotification';
  autoGenEmployeeId = '';
  autoGenDate = new Date().toISOString().slice(0, 10);

  displayedColumns = ['filingType', 'employeeName', 'effectiveDate', 'workflowStatus', 'submissionStatus'];

  ngOnInit() {
    this.autoGenEmployeeId = this.route.snapshot.queryParamMap.get('employeeId') ?? '';
    if (this.autoGenEmployeeId) this.showAutoGen.set(true);
    this.loadFilings();
    this.loadEmployees();
  }

  async loadEmployees() {
    if (this.employeesLoading()) return;
    this.employeesLoading.set(true);
    this.employeesError.set('');
    try {
      const fn = httpsCallable<object, { items: EmployeeListItem[] }>(this.functions, 'employeeList');
      const { data } = await fn({ companyId: this.auth.companyId, ...this.office.params(), limit: 100 });
      this.employees.set((data.items ?? []).map(e => ({
        id: e.id, name: `${e.lastName} ${e.firstName}`, number: e.employeeNumber || '-',
      })));
    } catch {
      this.employeesError.set('従業員を取得できませんでした。再読み込みしてください。');
    } finally {
      this.employeesLoading.set(false);
    }
  }

  filteredFilings() {
    return this.filings().filter((f) => {
      if (this.workflowFilter() !== 'all' && f.workflowStatus !== this.workflowFilter()) return false;
      if (this.submissionFilter() !== 'all' && f.submissionStatus !== this.submissionFilter()) return false;
      return true;
    });
  }

  viewDetail(row: FilingRow) {
    this.router.navigate(['/filings', row.id], { queryParams: { employeeId: row.employeeId } });
  }

  filingTypeLabel(type: string): string { return FILING_TYPE_LABELS[type] ?? type; }
  workflowLabel(status: string): string { return WORKFLOW_LABELS[status] ?? status; }
  submissionLabel(status: string): string { return SUBMISSION_LABELS[status] ?? status; }

  openAutoGenerate() {
    this.showAutoGen.set(true);
  }

  async executeAutoGenerate() {
    if (!this.autoGenEmployeeId || !this.autoGenDate) {
      this.snackBar.open('対象従業員と届出日を選択してください', '閉じる', { duration: 3000 });
      return;
    }
    this.generating.set(true);
    try {
      const fn = httpsCallable<any, any>(this.functions, 'filingAutoGenerate');
      const result = await fn({
        companyId: this.auth.companyId,
        employeeId: this.autoGenEmployeeId,
        filingType: this.autoGenType,
        effectiveDate: this.autoGenDate,
      });
      this.snackBar.open('届出を自動生成しました', '閉じる', { duration: 3000 });
      this.showAutoGen.set(false);
      this.loadFilings();
      this.router.navigate(['/filings', result.data.id], { queryParams: { employeeId: this.autoGenEmployeeId } });
    } catch (e: any) {
      this.snackBar.open(`エラー: ${e.message}`, '閉じる', { duration: 5000 });
    } finally {
      this.generating.set(false);
    }
  }

  private async loadFilings() {
    this.loading.set(true);
    try {
      const fn = httpsCallable<any, any>(this.functions, 'filingList');
      const employeeId = this.route.snapshot.queryParamMap.get('employeeId');
      const result = await fn({ companyId: this.auth.companyId, ...this.office.params(), ...(employeeId ? {employeeId}: {}) });
      this.filings.set(result.data.items ?? []);
    } catch {
      this.filings.set([]);
    } finally {
      this.loading.set(false);
    }
  }
}
