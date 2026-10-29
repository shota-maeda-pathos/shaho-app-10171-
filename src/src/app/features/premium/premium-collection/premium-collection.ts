import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../../core/services/auth.service';

interface CollectionRow {
  employeeId: string;
  employeeName: string;
  totalPremium: number;
  deducted: number;
  balance: number;
  status: 'collected' | 'partial' | 'uncollected' | 'overpaid';
}

@Component({
  selector: 'app-premium-collection',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatButtonModule, MatIconModule, MatCardModule, MatTableModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatChipsModule,
    MatProgressSpinnerModule, MatSnackBarModule, MatTabsModule,
  ],
  template: `
    <div class="page-container">
      <div class="page-header">
        <h1>徴収実績</h1>
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

      <div class="summary-cards">
        <mat-card class="summary-card">
          <div class="summary-label">保険料合計</div>
          <div class="summary-value">{{ totalPremium() | number }} 円</div>
        </mat-card>
        <mat-card class="summary-card">
          <div class="summary-label">徴収済</div>
          <div class="summary-value collected">{{ totalDeducted() | number }} 円</div>
        </mat-card>
        <mat-card class="summary-card">
          <div class="summary-label">未徴収</div>
          <div class="summary-value uncollected">{{ totalBalance() | number }} 円</div>
        </mat-card>
      </div>

      <mat-tab-group>
        <mat-tab label="全件">
          <ng-template matTabContent>
            @if (loading()) {
              <div class="loading-container"><mat-spinner diameter="40"></mat-spinner></div>
            } @else {
              <table mat-table [dataSource]="rows()" class="full-width-table">
                <ng-container matColumnDef="employeeName">
                  <th mat-header-cell *matHeaderCellDef>従業員</th>
                  <td mat-cell *matCellDef="let row">{{ row.employeeName }}</td>
                </ng-container>
                <ng-container matColumnDef="totalPremium">
                  <th mat-header-cell *matHeaderCellDef>保険料</th>
                  <td mat-cell *matCellDef="let row" class="text-right">{{ row.totalPremium | number }}</td>
                </ng-container>
                <ng-container matColumnDef="deducted">
                  <th mat-header-cell *matHeaderCellDef>控除済</th>
                  <td mat-cell *matCellDef="let row" class="text-right">{{ row.deducted | number }}</td>
                </ng-container>
                <ng-container matColumnDef="balance">
                  <th mat-header-cell *matHeaderCellDef>残額</th>
                  <td mat-cell *matCellDef="let row" class="text-right" [class.warn]="row.balance > 0">
                    {{ row.balance | number }}
                  </td>
                </ng-container>
                <ng-container matColumnDef="status">
                  <th mat-header-cell *matHeaderCellDef>状態</th>
                  <td mat-cell *matCellDef="let row">
                    <span class="status-chip" [class]="row.status">{{ statusLabel(row.status) }}</span>
                  </td>
                </ng-container>
                <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
                <tr mat-row *matRowDef="let row; columns: displayedColumns"></tr>
              </table>
              @if (rows().length === 0) {
                <div class="empty-state">
                  <mat-icon>account_balance</mat-icon>
                  <p>{{ selectedMonth() }}の徴収データがありません</p>
                </div>
              }
            }
          </ng-template>
        </mat-tab>
        <mat-tab [label]="'未徴収 (' + uncollectedCount() + ')'">
          <ng-template matTabContent>
            <table mat-table [dataSource]="uncollectedRows()" class="full-width-table">
              <ng-container matColumnDef="employeeName">
                <th mat-header-cell *matHeaderCellDef>従業員</th>
                <td mat-cell *matCellDef="let row">{{ row.employeeName }}</td>
              </ng-container>
              <ng-container matColumnDef="totalPremium">
                <th mat-header-cell *matHeaderCellDef>保険料</th>
                <td mat-cell *matCellDef="let row" class="text-right">{{ row.totalPremium | number }}</td>
              </ng-container>
              <ng-container matColumnDef="deducted">
                <th mat-header-cell *matHeaderCellDef>控除済</th>
                <td mat-cell *matCellDef="let row" class="text-right">{{ row.deducted | number }}</td>
              </ng-container>
              <ng-container matColumnDef="balance">
                <th mat-header-cell *matHeaderCellDef>残額</th>
                <td mat-cell *matCellDef="let row" class="text-right warn">{{ row.balance | number }}</td>
              </ng-container>
              <ng-container matColumnDef="status">
                <th mat-header-cell *matHeaderCellDef>状態</th>
                <td mat-cell *matCellDef="let row">
                  <span class="status-chip uncollected">{{ statusLabel(row.status) }}</span>
                </td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: displayedColumns"></tr>
            </table>
          </ng-template>
        </mat-tab>
      </mat-tab-group>
    </div>
  `,
  styles: [`
    .page-container { padding: 24px; }
    .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
    .page-header h1 { margin: 0; font-size: 24px; font-weight: 500; }
    .month-select { width: 160px; }
    .summary-cards { display: flex; gap: 16px; margin-bottom: 24px; }
    .summary-card { flex: 1; padding: 16px; text-align: center; }
    .summary-label { font-size: 12px; color: #666; }
    .summary-value { font-size: 24px; font-weight: 600; margin-top: 4px; }
    .summary-value.collected { color: #2e7d32; }
    .summary-value.uncollected { color: #c62828; }
    .full-width-table { width: 100%; }
    .text-right { text-align: right; }
    .warn { color: #c62828; font-weight: 500; }
    .loading-container { display: flex; justify-content: center; padding: 48px; }
    .empty-state { text-align: center; padding: 48px; color: #666; }
    .empty-state mat-icon { font-size: 48px; width: 48px; height: 48px; color: #ccc; }
    .status-chip { padding: 4px 12px; border-radius: 16px; font-size: 12px; }
    .status-chip.collected { background: #e8f5e9; color: #2e7d32; }
    .status-chip.uncollected { background: #ffebee; color: #c62828; }
    .status-chip.partial { background: #fff3e0; color: #e65100; }
    .status-chip.overpaid { background: #e3f2fd; color: #1565c0; }
  `],
})
export class PremiumCollectionComponent implements OnInit {
  private functions = inject(Functions);
  private auth = inject(AuthService);

  rows = signal<CollectionRow[]>([]);
  uncollectedRows = signal<CollectionRow[]>([]);
  loading = signal(false);
  selectedMonth = signal(this.getCurrentMonth());

  totalPremium = signal(0);
  totalDeducted = signal(0);
  totalBalance = signal(0);
  uncollectedCount = signal(0);

  displayedColumns = ['employeeName', 'totalPremium', 'deducted', 'balance', 'status'];
  months = this.generateMonths();

  ngOnInit() {
    this.loadData();
  }

  onMonthChange(month: string) {
    this.selectedMonth.set(month);
    this.loadData();
  }

  statusLabel(status: string): string {
    const labels: Record<string, string> = {
      collected: '徴収済', partial: '一部徴収', uncollected: '未徴収', overpaid: '過徴収',
    };
    return labels[status] ?? status;
  }

  private async loadData() {
    this.loading.set(true);
    try {
      const fn = httpsCallable<any, any>(this.functions, 'collectionSummary');
      const { data } = await fn({
        companyId: this.auth.companyId,
        yearMonth: this.selectedMonth(),
      });

      const all: CollectionRow[] = (data.rows ?? []).map((r: any) => {
        const premium = r.totalEmployee;
        const deducted = r.isConfirmed ? premium : 0;
        const balance = premium - deducted;
        return {
          employeeId: r.employeeId,
          employeeName: r.employeeName,
          totalPremium: premium,
          deducted,
          balance,
          status: deducted >= premium ? 'collected' as const
            : deducted > 0 ? 'partial' as const
            : 'uncollected' as const,
        };
      });

      this.rows.set(all);
      this.uncollectedRows.set(all.filter((r) => r.status !== 'collected'));
      this.uncollectedCount.set(this.uncollectedRows().length);
      this.totalPremium.set(data.totals?.totalEmployee ?? 0);
      this.totalDeducted.set(all.reduce((s, r) => s + r.deducted, 0));
      this.totalBalance.set(all.reduce((s, r) => s + r.balance, 0));
    } catch {
      this.rows.set([]);
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
    for (let i = -6; i <= 1; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    return months;
  }
}
