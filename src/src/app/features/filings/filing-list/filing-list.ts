import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Functions, httpsCallable } from '@angular/fire/functions';

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
    CommonModule,
    MatTableModule, MatButtonModule, MatIconModule, MatCardModule,
    MatChipsModule, MatFormFieldModule, MatSelectModule, MatProgressSpinnerModule,
  ],
  template: `
    <div class="page-container">
      <div class="page-header">
        <h1>届出管理</h1>
      </div>

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
              <td mat-cell *matCellDef="let row">{{ filingTypeLabel(row.filingType) }}</td>
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
  `],
})
export class FilingListComponent implements OnInit {
  private functions = inject(Functions);

  filings = signal<FilingRow[]>([]);
  loading = signal(false);
  workflowFilter = signal('all');
  submissionFilter = signal('all');

  displayedColumns = ['filingType', 'employeeName', 'effectiveDate', 'workflowStatus', 'submissionStatus'];

  ngOnInit() {
    this.loadFilings();
  }

  filteredFilings() {
    return this.filings().filter((f) => {
      if (this.workflowFilter() !== 'all' && f.workflowStatus !== this.workflowFilter()) return false;
      if (this.submissionFilter() !== 'all' && f.submissionStatus !== this.submissionFilter()) return false;
      return true;
    });
  }

  filingTypeLabel(type: string): string { return FILING_TYPE_LABELS[type] ?? type; }
  workflowLabel(status: string): string { return WORKFLOW_LABELS[status] ?? status; }
  submissionLabel(status: string): string { return SUBMISSION_LABELS[status] ?? status; }

  private async loadFilings() {
    this.loading.set(true);
    try {
      const fn = httpsCallable<any, any>(this.functions, 'filingList');
      const result = await fn({ companyId: 'company-001' });
      this.filings.set(result.data.items ?? []);
    } catch {
      this.filings.set([]);
    } finally {
      this.loading.set(false);
    }
  }
}
