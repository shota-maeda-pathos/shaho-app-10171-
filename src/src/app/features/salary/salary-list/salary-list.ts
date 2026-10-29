import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../../core/services/auth.service';

interface SalaryRow {
  employeeId: string;
  employeeName: string;
  yearMonth: string;
  baseSalary: number;
  totalSalary: number;
  isConfirmed: boolean;
  version: number;
}

@Component({
  selector: 'app-salary-list',
  standalone: true,
  imports: [
    CommonModule,
    MatTableModule, MatButtonModule, MatIconModule, MatCardModule,
    MatFormFieldModule, MatSelectModule, MatChipsModule, MatProgressSpinnerModule,
    MatSnackBarModule,
  ],
  template: `
    <div class="page-container">
      <div class="page-header">
        <h1>給与管理</h1>
        <div class="header-actions">
          <button mat-stroked-button (click)="downloadCsvTemplate()">
            <mat-icon>download</mat-icon> CSVテンプレート
          </button>
          <button mat-stroked-button (click)="csvFileInput.click()" [disabled]="importing()">
            <mat-icon>upload_file</mat-icon> CSV取込
          </button>
          <input #csvFileInput type="file" accept=".csv" hidden (change)="onCsvFileSelected($event)">
          <button mat-stroked-button (click)="seedGrades()" [disabled]="seeding()">
            <mat-icon>auto_fix_high</mat-icon> 等級一括作成
          </button>
          <button mat-flat-button color="primary" (click)="confirmAll()" [disabled]="confirming() || !hasUnconfirmed()">
            <mat-icon>check_circle</mat-icon> 一括確定
          </button>
          <button mat-flat-button color="accent" (click)="publishAll()" [disabled]="publishing() || !hasPublishable()">
            <mat-icon>visibility</mat-icon> 明細公開
          </button>
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
              <td mat-cell *matCellDef="let row">
                <a class="link" (click)="editSalary(row.employeeId)">{{ row.employeeName }}</a>
              </td>
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
    .header-actions { display: flex; align-items: center; gap: 12px; }
    .month-select { width: 160px; }
    .full-width-table { width: 100%; }
    .text-right { text-align: right; }
    .loading-container { display: flex; justify-content: center; padding: 48px; }
    .empty-state { text-align: center; padding: 48px; color: #666; }
    .empty-state mat-icon { font-size: 48px; width: 48px; height: 48px; color: #ccc; }
    .status-chip { padding: 4px 12px; border-radius: 16px; font-size: 12px; background: #f5f5f5; }
    .status-chip.confirmed { background: #e8f5e9; color: #2e7d32; }
    .link { color: #1976d2; cursor: pointer; text-decoration: none; }
    .link:hover { text-decoration: underline; }
  `],
})
export class SalaryListComponent implements OnInit {
  private functions = inject(Functions);
  private router = inject(Router);
  private snackBar = inject(MatSnackBar);
  private auth = inject(AuthService);

  salaries = signal<SalaryRow[]>([]);
  loading = signal(false);
  confirming = signal(false);
  seeding = signal(false);
  importing = signal(false);
  publishing = signal(false);
  hasPublishable = signal(false);
  selectedMonth = signal(this.getCurrentMonth());
  displayedColumns = ['employeeName', 'baseSalary', 'totalSalary', 'status'];
  hasUnconfirmed = signal(false);

  months = this.generateMonths();

  ngOnInit() {
    this.loadSalaries();
  }

  editSalary(employeeId: string) {
    this.router.navigate(['/salary', employeeId], { queryParams: { month: this.selectedMonth() } });
  }

  onMonthChange(month: string) {
    this.selectedMonth.set(month);
    this.loadSalaries();
  }

  private async loadSalaries() {
    this.loading.set(true);
    try {
      const fn = httpsCallable<any, any>(this.functions, 'salaryList');
      const result = await fn({
        companyId: 'company-001',
        yearMonth: this.selectedMonth(),
      });
      const items = result.data.items ?? [];
      this.salaries.set(items);
      this.hasUnconfirmed.set(items.some((s: SalaryRow) => !s.isConfirmed && s.baseSalary > 0));
      this.hasPublishable.set(items.some((s: any) => s.isConfirmed && !s.isPublished));
    } catch {
      this.salaries.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  private getCurrentMonth(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  async confirmAll() {
    this.confirming.set(true);
    try {
      const fn = httpsCallable<any, any>(this.functions, 'salaryUpdate');
      const targets = this.salaries().filter(s => !s.isConfirmed && s.baseSalary > 0);
      for (const s of targets) {
        await fn({
          companyId: this.auth.companyId,
          employeeId: s.employeeId,
          salaryId: s.yearMonth,
          expectedVersion: s.version,
          isConfirmed: true,
        });
      }
      this.snackBar.open(`${targets.length}件の給与を確定しました`, '閉じる', { duration: 3000 });
      await this.loadSalaries();
    } catch (e: any) {
      this.snackBar.open(`確定に失敗: ${e.message}`, '閉じる', { duration: 5000 });
    } finally {
      this.confirming.set(false);
    }
  }

  async seedGrades() {
    this.seeding.set(true);
    try {
      const fn = httpsCallable<any, any>(this.functions, 'seedGrades');
      const result = await fn({ companyId: this.auth.companyId });
      this.snackBar.open(result.data.message, '閉じる', { duration: 5000 });
    } catch (e: any) {
      this.snackBar.open(`等級作成失敗: ${e.message}`, '閉じる', { duration: 5000 });
    } finally {
      this.seeding.set(false);
    }
  }

  async publishAll() {
    this.publishing.set(true);
    try {
      const targets = this.salaries().filter((s: any) => s.isConfirmed && !s.isPublished);
      const fn = httpsCallable<any, any>(this.functions, 'salaryPublish');
      const result = await fn({
        companyId: this.auth.companyId,
        yearMonth: this.selectedMonth(),
        employeeIds: targets.map(s => s.employeeId),
      });
      const d = result.data;
      this.snackBar.open(`${d.published}件の明細を公開しました`, '閉じる', { duration: 3000 });
      await this.loadSalaries();
    } catch (e: any) {
      this.snackBar.open(`公開に失敗: ${e.message}`, '閉じる', { duration: 5000 });
    } finally {
      this.publishing.set(false);
    }
  }

  downloadCsvTemplate() {
    const header = '社員番号,支払基礎日数,基本給,通勤手当,住宅手当,残業手当';
    const sample = '001,20,300000,15000,20000,45000';
    const csv = `${header}\n${sample}\n`;
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `給与テンプレート_${this.selectedMonth()}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  async onCsvFileSelected(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    (event.target as HTMLInputElement).value = '';

    this.importing.set(true);
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) { this.snackBar.open('CSVにデータ行がありません', '閉じる', { duration: 3000 }); return; }

      const header = lines[0].split(',').map(h => h.trim());
      const empNumIdx = header.findIndex(h => h.includes('社員番号'));
      const daysIdx = header.findIndex(h => h.includes('支払基礎日数'));
      const baseIdx = header.findIndex(h => h.includes('基本給'));
      if (empNumIdx < 0 || daysIdx < 0 || baseIdx < 0) {
        this.snackBar.open('CSVヘッダーに「社員番号」「支払基礎日数」「基本給」が必要です', '閉じる', { duration: 5000 });
        return;
      }

      const fixedKeys = ['通勤手当', '住宅手当', '家族手当', '役職手当'];
      const variableKeys = ['残業手当', '深夜手当', '休日手当'];

      const csvRows = lines.slice(1).map(line => {
        const cols = line.split(',').map(c => c.trim());
        const fixed: Record<string, number> = {};
        const variable: Record<string, number> = {};
        header.forEach((h, idx) => {
          if (idx === empNumIdx || idx === daysIdx || idx === baseIdx) return;
          const val = parseInt(cols[idx], 10);
          if (isNaN(val) || val === 0) return;
          if (variableKeys.includes(h)) { variable[h] = val; }
          else if (fixedKeys.includes(h) || !variableKeys.includes(h)) { fixed[h] = val; }
        });
        return {
          employeeNumber: cols[empNumIdx],
          paymentBasisDays: parseInt(cols[daysIdx], 10) || 20,
          baseSalary: parseInt(cols[baseIdx], 10) || 0,
          ...(Object.keys(fixed).length > 0 ? { fixedAllowances: fixed } : {}),
          ...(Object.keys(variable).length > 0 ? { variableAllowances: variable } : {}),
        };
      }).filter(r => r.employeeNumber && r.baseSalary > 0);

      if (csvRows.length === 0) {
        this.snackBar.open('有効なデータ行がありません', '閉じる', { duration: 3000 });
        return;
      }

      const fn = httpsCallable<any, any>(this.functions, 'salaryCsvImport');
      const result = await fn({ companyId: this.auth.companyId, yearMonth: this.selectedMonth(), csvRows });
      const d = result.data;
      let msg = `${d.imported}件取込完了`;
      if (d.skipped > 0) msg += `（${d.skipped}件スキップ）`;
      this.snackBar.open(msg, '閉じる', { duration: 5000 });
      if (d.errors?.length) console.warn('CSV取込エラー:', d.errors);
      await this.loadSalaries();
    } catch (e: any) {
      this.snackBar.open(`CSV取込エラー: ${e.message}`, '閉じる', { duration: 5000 });
    } finally {
      this.importing.set(false);
    }
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
