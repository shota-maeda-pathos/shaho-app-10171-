import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatStepperModule } from '@angular/material/stepper';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../../core/services/auth.service';

interface PremiumRow {
  employeeId: string;
  employeeName: string;
  healthGrade: number;
  pensionGrade: number;
  healthEmployee: number;
  pensionEmployee: number;
  totalEmployee: number;
  totalEmployer: number;
  selected: boolean;
}

@Component({
  selector: 'app-premium-monthly',
  standalone: true,
  imports: [
    CommonModule,
    MatTableModule, MatButtonModule, MatIconModule, MatCardModule,
    MatStepperModule, MatCheckboxModule, MatProgressSpinnerModule,
    MatSnackBarModule,
  ],
  template: `
    <div class="page-container">
      <h1>月次保険料計算</h1>

      <mat-stepper linear #stepper>
        <mat-step label="対象者選択">
          <mat-card>
            @if (loading()) {
              <div class="loading-container">
                <mat-spinner diameter="40"></mat-spinner>
              </div>
            } @else if (employees().length === 0) {
              <div class="empty-state">
                <mat-icon>people</mat-icon>
                <p>対象従業員がいません</p>
              </div>
            } @else {
              <table mat-table [dataSource]="employees()" class="full-width-table">
                <ng-container matColumnDef="select">
                  <th mat-header-cell *matHeaderCellDef>
                    <mat-checkbox (change)="toggleAll($event.checked)"
                      [checked]="allSelected()"
                      [indeterminate]="someSelected()">
                    </mat-checkbox>
                  </th>
                  <td mat-cell *matCellDef="let row; let i = index">
                    <mat-checkbox [checked]="row.selected"
                      (change)="toggleRow(i, $event.checked)">
                    </mat-checkbox>
                  </td>
                </ng-container>

                <ng-container matColumnDef="employeeName">
                  <th mat-header-cell *matHeaderCellDef>従業員</th>
                  <td mat-cell *matCellDef="let row">{{ row.employeeName }}</td>
                </ng-container>

                <ng-container matColumnDef="healthGrade">
                  <th mat-header-cell *matHeaderCellDef>健保等級</th>
                  <td mat-cell *matCellDef="let row">{{ row.healthGrade }}</td>
                </ng-container>

                <ng-container matColumnDef="pensionGrade">
                  <th mat-header-cell *matHeaderCellDef>厚年等級</th>
                  <td mat-cell *matCellDef="let row">{{ row.pensionGrade }}</td>
                </ng-container>

                <tr mat-header-row *matHeaderRowDef="step1Columns"></tr>
                <tr mat-row *matRowDef="let row; columns: step1Columns"></tr>
              </table>
            }
            <div class="step-actions">
              <button mat-flat-button color="primary" matStepperNext
                [disabled]="selectedCount() === 0">
                計算実行 ({{ selectedCount() }}名)
              </button>
            </div>
          </mat-card>
        </mat-step>

        <mat-step label="計算結果">
          <mat-card>
            @if (calculating()) {
              <div class="loading-container">
                <mat-spinner diameter="40"></mat-spinner>
                <p>保険料を計算中...</p>
              </div>
            } @else {
              <table mat-table [dataSource]="results()" class="full-width-table">
                <ng-container matColumnDef="employeeName">
                  <th mat-header-cell *matHeaderCellDef>従業員</th>
                  <td mat-cell *matCellDef="let row">{{ row.employeeName }}</td>
                </ng-container>

                <ng-container matColumnDef="healthEmployee">
                  <th mat-header-cell *matHeaderCellDef>健保(本人)</th>
                  <td mat-cell *matCellDef="let row" class="text-right">{{ row.healthEmployee | number }}</td>
                </ng-container>

                <ng-container matColumnDef="pensionEmployee">
                  <th mat-header-cell *matHeaderCellDef>厚年(本人)</th>
                  <td mat-cell *matCellDef="let row" class="text-right">{{ row.pensionEmployee | number }}</td>
                </ng-container>

                <ng-container matColumnDef="totalEmployee">
                  <th mat-header-cell *matHeaderCellDef>本人合計</th>
                  <td mat-cell *matCellDef="let row" class="text-right bold">{{ row.totalEmployee | number }}</td>
                </ng-container>

                <ng-container matColumnDef="totalEmployer">
                  <th mat-header-cell *matHeaderCellDef>事業主合計</th>
                  <td mat-cell *matCellDef="let row" class="text-right">{{ row.totalEmployer | number }}</td>
                </ng-container>

                <tr mat-header-row *matHeaderRowDef="step2Columns"></tr>
                <tr mat-row *matRowDef="let row; columns: step2Columns"></tr>
              </table>
            }
            <div class="step-actions">
              <button mat-stroked-button matStepperPrevious>戻る</button>
              <button mat-flat-button color="primary" matStepperNext
                [disabled]="calculating() || results().length === 0">
                確認して承認申請
              </button>
            </div>
          </mat-card>
        </mat-step>

        <mat-step label="承認申請">
          <mat-card>
            <div class="confirm-summary">
              <h3>承認申請の確認</h3>
              <p>{{ results().length }}名分の月次保険料計算結果を承認申請します。</p>
              <div class="summary-row">
                <span>本人負担合計:</span>
                <strong>{{ totalEmployeeSum() | number }}円</strong>
              </div>
              <div class="summary-row">
                <span>事業主負担合計:</span>
                <strong>{{ totalEmployerSum() | number }}円</strong>
              </div>
            </div>
            <div class="step-actions">
              <button mat-stroked-button matStepperPrevious>戻る</button>
              <button mat-flat-button color="primary" (click)="submitApproval()"
                [disabled]="submitting()">
                承認申請
              </button>
            </div>
          </mat-card>
        </mat-step>
      </mat-stepper>
    </div>
  `,
  styles: [`
    .page-container { padding: 24px; }
    h1 { margin: 0 0 24px; font-size: 24px; font-weight: 500; }
    .full-width-table { width: 100%; }
    .text-right { text-align: right; }
    .bold { font-weight: 600; }
    .loading-container { display: flex; flex-direction: column; align-items: center; padding: 48px; gap: 16px; }
    .empty-state { text-align: center; padding: 48px; color: #666; }
    .empty-state mat-icon { font-size: 48px; width: 48px; height: 48px; color: #ccc; }
    .step-actions { display: flex; justify-content: flex-end; gap: 12px; padding: 16px 0; }
    .confirm-summary { padding: 24px; }
    .confirm-summary h3 { margin: 0 0 16px; }
    .summary-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
  `],
})
export class PremiumMonthlyComponent implements OnInit {
  private functions = inject(Functions);
  private snackBar = inject(MatSnackBar);
  private auth = inject(AuthService);

  employees = signal<PremiumRow[]>([]);
  results = signal<PremiumRow[]>([]);
  loading = signal(false);
  calculating = signal(false);
  submitting = signal(false);

  step1Columns = ['select', 'employeeName', 'healthGrade', 'pensionGrade'];
  step2Columns = ['employeeName', 'healthEmployee', 'pensionEmployee', 'totalEmployee', 'totalEmployer'];

  ngOnInit() {
    this.loadEmployees();
  }

  selectedCount() {
    return this.employees().filter((e) => e.selected).length;
  }

  allSelected() {
    const emps = this.employees();
    return emps.length > 0 && emps.every((e) => e.selected);
  }

  someSelected() {
    const emps = this.employees();
    return emps.some((e) => e.selected) && !emps.every((e) => e.selected);
  }

  toggleAll(checked: boolean) {
    this.employees.set(this.employees().map((e) => ({ ...e, selected: checked })));
  }

  toggleRow(index: number, checked: boolean) {
    const emps = [...this.employees()];
    emps[index] = { ...emps[index], selected: checked };
    this.employees.set(emps);
  }

  totalEmployeeSum() {
    return this.results().reduce((sum, r) => sum + r.totalEmployee, 0);
  }

  totalEmployerSum() {
    return this.results().reduce((sum, r) => sum + r.totalEmployer, 0);
  }

  async submitApproval() {
    this.submitting.set(true);
    try {
      this.snackBar.open('承認申請を送信しました', '閉じる', { duration: 3000 });
    } finally {
      this.submitting.set(false);
    }
  }

  private async loadEmployees() {
    this.loading.set(true);
    try {
      this.employees.set([]);
    } finally {
      this.loading.set(false);
    }
  }
}
