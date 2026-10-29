import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../../core/services/auth.service';

interface SanteiRow {
  employeeId: string;
  employeeName: string;
  apr: number;
  may: number;
  jun: number;
  average: number;
  currentGrade: number;
  proposedGrade: number;
  gradeChanged: boolean;
  basisDays: { apr: number; may: number; jun: number };
}

@Component({
  selector: 'app-santei-list',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule, MatIconModule, MatCardModule, MatTableModule,
    MatChipsModule, MatProgressSpinnerModule, MatSnackBarModule,
  ],
  template: `
    <div class="page-container">
      <div class="page-header">
        <h1>算定基礎届</h1>
        <span class="year-badge">{{ targetYear() }}年度</span>
      </div>

      <div class="summary-cards">
        <mat-card class="summary-card">
          <div class="summary-label">対象者数</div>
          <div class="summary-value">{{ rows().length }} 名</div>
        </mat-card>
        <mat-card class="summary-card">
          <div class="summary-label">等級変更あり</div>
          <div class="summary-value changed">{{ changedCount() }} 名</div>
        </mat-card>
        <mat-card class="summary-card">
          <div class="summary-label">除外者</div>
          <div class="summary-value">{{ excludedCount() }} 名</div>
        </mat-card>
      </div>

      @if (loading()) {
        <div class="loading-container"><mat-spinner diameter="40"></mat-spinner></div>
      } @else {
        <mat-card>
          <table mat-table [dataSource]="rows()" class="full-width-table">
            <ng-container matColumnDef="employeeName">
              <th mat-header-cell *matHeaderCellDef>従業員</th>
              <td mat-cell *matCellDef="let row">
                <a class="link" (click)="viewDetail(row.employeeId)">{{ row.employeeName }}</a>
              </td>
            </ng-container>
            <ng-container matColumnDef="apr">
              <th mat-header-cell *matHeaderCellDef>4月</th>
              <td mat-cell *matCellDef="let row" class="text-right">{{ row.apr | number }}</td>
            </ng-container>
            <ng-container matColumnDef="may">
              <th mat-header-cell *matHeaderCellDef>5月</th>
              <td mat-cell *matCellDef="let row" class="text-right">{{ row.may | number }}</td>
            </ng-container>
            <ng-container matColumnDef="jun">
              <th mat-header-cell *matHeaderCellDef>6月</th>
              <td mat-cell *matCellDef="let row" class="text-right">{{ row.jun | number }}</td>
            </ng-container>
            <ng-container matColumnDef="average">
              <th mat-header-cell *matHeaderCellDef>平均</th>
              <td mat-cell *matCellDef="let row" class="text-right bold">{{ row.average | number }}</td>
            </ng-container>
            <ng-container matColumnDef="currentGrade">
              <th mat-header-cell *matHeaderCellDef>現等級</th>
              <td mat-cell *matCellDef="let row" class="text-center">{{ row.currentGrade }}</td>
            </ng-container>
            <ng-container matColumnDef="proposedGrade">
              <th mat-header-cell *matHeaderCellDef>新等級</th>
              <td mat-cell *matCellDef="let row" class="text-center">
                <span [class.grade-changed]="row.gradeChanged">{{ row.proposedGrade }}</span>
              </td>
            </ng-container>
            <ng-container matColumnDef="status">
              <th mat-header-cell *matHeaderCellDef>状態</th>
              <td mat-cell *matCellDef="let row">
                <span class="status-chip" [class.changed]="row.gradeChanged">
                  {{ row.gradeChanged ? '変更あり' : '変更なし' }}
                </span>
              </td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
            <tr mat-row *matRowDef="let row; columns: displayedColumns"
                [class.highlight]="row.gradeChanged"></tr>
          </table>

          @if (rows().length === 0) {
            <div class="empty-state">
              <mat-icon>assessment</mat-icon>
              <p>算定基礎届の対象者がいません</p>
            </div>
          }
        </mat-card>

        @if (rows().length > 0) {
          <div class="action-bar">
            <button mat-flat-button color="primary" (click)="submitAll()" [disabled]="submitting()">
              <mat-icon>send</mat-icon> 一括承認申請
            </button>
          </div>
        }
      }
    </div>
  `,
  styles: [`
    .page-container { padding: 24px; }
    .page-header { display: flex; align-items: center; gap: 16px; margin-bottom: 24px; }
    .page-header h1 { margin: 0; font-size: 24px; font-weight: 500; }
    .year-badge { padding: 4px 12px; border-radius: 16px; background: #e8eaf6; color: #283593; font-size: 14px; }
    .summary-cards { display: flex; gap: 16px; margin-bottom: 24px; }
    .summary-card { flex: 1; padding: 16px; text-align: center; }
    .summary-label { font-size: 12px; color: #666; }
    .summary-value { font-size: 24px; font-weight: 600; margin-top: 4px; }
    .summary-value.changed { color: #e65100; }
    .full-width-table { width: 100%; }
    .text-right { text-align: right; }
    .text-center { text-align: center; }
    .bold { font-weight: 600; }
    .link { color: #1976d2; cursor: pointer; text-decoration: none; }
    .link:hover { text-decoration: underline; }
    .grade-changed { color: #e65100; font-weight: 700; }
    .status-chip { padding: 4px 12px; border-radius: 16px; font-size: 12px; background: #f5f5f5; }
    .status-chip.changed { background: #fff3e0; color: #e65100; }
    .highlight { background: #fff8e1; }
    .loading-container { display: flex; justify-content: center; padding: 48px; }
    .empty-state { text-align: center; padding: 48px; color: #666; }
    .empty-state mat-icon { font-size: 48px; width: 48px; height: 48px; color: #ccc; }
    .action-bar { display: flex; justify-content: flex-end; margin-top: 16px; }
  `],
})
export class SanteiListComponent implements OnInit {
  private router = inject(Router);
  private functions = inject(Functions);
  private snackBar = inject(MatSnackBar);
  private auth = inject(AuthService);

  rows = signal<SanteiRow[]>([]);
  loading = signal(false);
  submitting = signal(false);
  targetYear = signal(new Date().getFullYear());
  changedCount = signal(0);
  excludedCount = signal(0);

  displayedColumns = ['employeeName', 'apr', 'may', 'jun', 'average', 'currentGrade', 'proposedGrade', 'status'];

  ngOnInit() {
    this.loadSanteiData();
  }

  viewDetail(employeeId: string) {
    this.router.navigate(['/santei', employeeId]);
  }

  async submitAll() {
    this.submitting.set(true);
    let sent = 0;
    try {
      const changed = this.rows().filter((r) => r.gradeChanged);
      for (const row of changed) {
        await httpsCallable(this.functions, 'approvalRequestCreate')({
          companyId: this.auth.companyId,
          employeeId: row.employeeId,
          targetPath: `companies/${this.auth.companyId}/employees/${row.employeeId}/grades/santei-${this.targetYear()}`,
          targetVersion: 0,
          requestType: 'grade',
          metadata: {
            effectiveMonth: `${this.targetYear()}-09`,
            determinationType: 'regular',
            healthGradeNumber: row.proposedGrade,
            healthStandardRemuneration: row.average,
            pensionGradeNumber: row.proposedGrade,
            pensionStandardRemuneration: row.average,
            reason: '算定基礎届による定時決定',
          },
        });
        sent++;
      }
      this.snackBar.open(`${sent}件の承認申請を送信しました`, '閉じる', { duration: 3000 });
    } catch (e: any) {
      this.snackBar.open(`エラー: ${e.message}（${sent}件送信済み）`, '閉じる', { duration: 5000 });
    } finally {
      this.submitting.set(false);
    }
  }

  private async loadSanteiData() {
    this.loading.set(true);
    const year = this.targetYear();
    try {
      const months = [`${year}-04`, `${year}-05`, `${year}-06`];
      const salaryData: Record<string, { apr: number; may: number; jun: number; name: string; basisDays: { apr: number; may: number; jun: number } }> = {};

      for (let i = 0; i < months.length; i++) {
        const fn = httpsCallable<any, any>(this.functions, 'salaryList');
        const result = await fn({
          companyId: this.auth.companyId,
          yearMonth: months[i],
          limit: 200,
        });
        for (const item of result.data.items ?? []) {
          if (!salaryData[item.employeeId]) {
            salaryData[item.employeeId] = { apr: 0, may: 0, jun: 0, name: item.employeeName, basisDays: { apr: 0, may: 0, jun: 0 } };
          }
          const key = ['apr', 'may', 'jun'][i] as 'apr' | 'may' | 'jun';
          salaryData[item.employeeId][key] = item.totalSalary;
        }
      }

      const rows: SanteiRow[] = Object.entries(salaryData).map(([id, data]) => {
        const validMonths = [data.apr, data.may, data.jun].filter((v) => v > 0);
        const average = validMonths.length > 0 ? Math.round(validMonths.reduce((s, v) => s + v, 0) / validMonths.length) : 0;
        const currentGrade = this.estimateGrade(average > 0 ? average * 0.8 : 0);
        const proposedGrade = this.estimateGrade(average);
        return {
          employeeId: id,
          employeeName: data.name,
          apr: data.apr,
          may: data.may,
          jun: data.jun,
          average,
          currentGrade,
          proposedGrade,
          gradeChanged: currentGrade !== proposedGrade,
          basisDays: data.basisDays,
        };
      });

      this.rows.set(rows);
      this.changedCount.set(rows.filter((r) => r.gradeChanged).length);
      this.excludedCount.set(0);
    } catch {
      this.rows.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  private estimateGrade(amount: number): number {
    const boundaries = [
      58000, 68000, 78000, 88000, 98000, 104000, 110000, 118000, 126000, 134000,
      142000, 150000, 160000, 170000, 180000, 190000, 200000, 220000, 240000, 260000,
      280000, 300000, 320000, 340000, 360000, 380000, 410000, 450000, 490000, 530000,
      590000, 650000, 710000, 770000, 830000, 890000, 950000, 1010000, 1090000, 1150000,
      1210000, 1270000, 1330000, 1390000,
    ];
    for (let i = 0; i < boundaries.length; i++) {
      if (amount < boundaries[i]) return i + 1;
    }
    return boundaries.length + 1;
  }
}
