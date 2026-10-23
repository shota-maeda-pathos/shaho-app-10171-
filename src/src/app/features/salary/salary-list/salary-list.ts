import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Functions, httpsCallable } from '@angular/fire/functions';

interface SalaryRow {
  employeeId: string;
  employeeName: string;
  yearMonth: string;
  baseSalary: number;
  totalSalary: number;
  isConfirmed: boolean;
}

@Component({
  selector: 'app-salary-list',
  standalone: true,
  imports: [
    CommonModule,
    MatTableModule, MatButtonModule, MatIconModule, MatCardModule,
    MatFormFieldModule, MatSelectModule, MatChipsModule, MatProgressSpinnerModule,
  ],
  template: `
    <div class="page-container">
      <div class="page-header">
        <h1>給与管理</h1>
        <div class="header-actions">
          <mat-form-field appearance="outline" class="month-select">
            <mat-label>対象月</mat-label>
            <mat-select [value]="selectedMonth()" (selectionChange)="onMonthChange($event.value)">
              @for (m of months; track m) {
                <mat-option [value]="m">{{ m }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        </div>
      </div>

      @if (loading()) {
        <div class="loading-container">
          <mat-spinner diameter="40"></mat-spinner>
        </div>
      } @else {
        <mat-card>
          <table mat-table [dataSource]="salaries()" class="full-width-table">
            <ng-container matColumnDef="employeeName">
              <th mat-header-cell *matHeaderCellDef>従業員</th>
              <td mat-cell *matCellDef="let row">{{ row.employeeName }}</td>
            </ng-container>

            <ng-container matColumnDef="baseSalary">
              <th mat-header-cell *matHeaderCellDef>基本給</th>
              <td mat-cell *matCellDef="let row" class="text-right">{{ row.baseSalary | number }}</td>
            </ng-container>

            <ng-container matColumnDef="totalSalary">
              <th mat-header-cell *matHeaderCellDef>総支給額</th>
              <td mat-cell *matCellDef="let row" class="text-right">{{ row.totalSalary | number }}</td>
            </ng-container>

            <ng-container matColumnDef="status">
              <th mat-header-cell *matHeaderCellDef>状態</th>
              <td mat-cell *matCellDef="let row">
                <span class="status-chip" [class.confirmed]="row.isConfirmed">
                  {{ row.isConfirmed ? '確定' : '未確定' }}
                </span>
              </td>
            </ng-container>

            <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
            <tr mat-row *matRowDef="let row; columns: displayedColumns"></tr>
          </table>

          @if (salaries().length === 0) {
            <div class="empty-state">
              <mat-icon>payments</mat-icon>
              <p>{{ selectedMonth() }}の給与データがありません</p>
            </div>
          }
        </mat-card>
      }
    </div>
  `,
  styles: [`
    .page-container { padding: 24px; }
    .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
    .page-header h1 { margin: 0; font-size: 24px; font-weight: 500; }
    .month-select { width: 160px; }
    .full-width-table { width: 100%; }
    .text-right { text-align: right; }
    .loading-container { display: flex; justify-content: center; padding: 48px; }
    .empty-state { text-align: center; padding: 48px; color: #666; }
    .empty-state mat-icon { font-size: 48px; width: 48px; height: 48px; color: #ccc; }
    .status-chip { padding: 4px 12px; border-radius: 16px; font-size: 12px; background: #f5f5f5; }
    .status-chip.confirmed { background: #e8f5e9; color: #2e7d32; }
  `],
})
export class SalaryListComponent implements OnInit {
  private functions = inject(Functions);

  salaries = signal<SalaryRow[]>([]);
  loading = signal(false);
  selectedMonth = signal(this.getCurrentMonth());
  displayedColumns = ['employeeName', 'baseSalary', 'totalSalary', 'status'];

  months = this.generateMonths();

  ngOnInit() {
    this.loadSalaries();
  }

  onMonthChange(month: string) {
    this.selectedMonth.set(month);
    this.loadSalaries();
  }

  private async loadSalaries() {
    this.loading.set(true);
    try {
      // Placeholder — actual implementation will call Cloud Functions
      this.salaries.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  private getCurrentMonth(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  private generateMonths(): string[] {
    const months: string[] = [];
    const now = new Date();
    for (let i = -3; i <= 3; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    return months;
  }
}
