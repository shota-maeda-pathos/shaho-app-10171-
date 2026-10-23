import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../../core/services/auth.service';

interface MonthData {
  yearMonth: string;
  label: string;
  totalSalary: number;
  baseSalary: number;
  paymentBasisDays: number;
  isValid: boolean;
}

@Component({
  selector: 'app-santei-detail',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule, MatIconModule, MatCardModule,
    MatDividerModule, MatProgressSpinnerModule, MatSnackBarModule,
  ],
  template: `
    <div class="page-container">
      <div class="page-header">
        <button mat-icon-button (click)="goBack()"><mat-icon>arrow_back</mat-icon></button>
        <h1>算定基礎届 — {{ employeeName() }}</h1>
      </div>

      @if (loading()) {
        <div class="loading-container"><mat-spinner diameter="40"></mat-spinner></div>
      } @else {
        <div class="month-cards">
          @for (m of monthData(); track m.yearMonth) {
            <mat-card [class.excluded]="!m.isValid">
              <h2>{{ m.label }}</h2>
              <div class="month-detail">
                <div class="detail-row">
                  <span class="label">支払基礎日数</span>
                  <span [class.warn]="m.paymentBasisDays < 17">{{ m.paymentBasisDays }} 日</span>
                </div>
                <div class="detail-row">
                  <span class="label">基本給</span>
                  <span>{{ m.baseSalary | number }} 円</span>
                </div>
                <div class="detail-row total">
                  <span class="label">総支給額</span>
                  <span>{{ m.totalSalary | number }} 円</span>
                </div>
              </div>
              @if (!m.isValid) {
                <div class="excluded-badge">
                  <mat-icon>warning</mat-icon>
                  日数不足のため除外
                </div>
              }
            </mat-card>
          }
        </div>

        <mat-card class="result-card">
          <h2>算定結果</h2>
          <div class="result-grid">
            <div class="result-item">
              <label>有効月数</label>
              <span>{{ validMonthCount() }} か月</span>
            </div>
            <div class="result-item">
              <label>3か月平均</label>
              <span class="large">{{ average() | number }} 円</span>
            </div>
            <div class="result-item">
              <label>現在の等級</label>
              <span>{{ currentGrade() }} 等級</span>
            </div>
            <div class="result-item highlight">
              <label>新等級（案）</label>
              <span class="large" [class.changed]="gradeChanged()">{{ proposedGrade() }} 等級</span>
            </div>
          </div>

          @if (gradeChanged()) {
            <div class="change-notice">
              <mat-icon>info</mat-icon>
              等級が変更されます。9月分から新等級が適用されます。
            </div>
          }

          <mat-divider></mat-divider>

          <div class="actions">
            <button mat-flat-button color="primary" (click)="confirmGrade()" [disabled]="confirming()">
              <mat-icon>check</mat-icon> 等級を確定
            </button>
          </div>
        </mat-card>
      }
    </div>
  `,
  styles: [`
    .page-container { padding: 24px; }
    .page-header { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
    .page-header h1 { margin: 0; font-size: 24px; font-weight: 500; }
    .loading-container { display: flex; justify-content: center; padding: 48px; }
    .month-cards { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin-bottom: 24px; }
    .month-cards mat-card { padding: 20px; }
    .month-cards mat-card.excluded { opacity: 0.6; border: 1px dashed #e0e0e0; }
    .month-cards h2 { margin: 0 0 12px; font-size: 16px; font-weight: 500; }
    .month-detail { display: flex; flex-direction: column; gap: 8px; }
    .detail-row { display: flex; justify-content: space-between; font-size: 14px; }
    .detail-row.total { font-weight: 600; border-top: 1px solid #e0e0e0; padding-top: 8px; }
    .label { color: #666; }
    .warn { color: #c62828; font-weight: 500; }
    .excluded-badge { display: flex; align-items: center; gap: 4px; margin-top: 12px; padding: 8px; background: #fff3e0; border-radius: 8px; font-size: 12px; color: #e65100; }
    .excluded-badge mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .result-card { padding: 24px; }
    .result-card h2 { margin: 0 0 16px; font-size: 18px; font-weight: 500; }
    .result-grid { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 16px; margin-bottom: 24px; }
    .result-item { display: flex; flex-direction: column; gap: 4px; padding: 12px; background: #f5f5f5; border-radius: 8px; }
    .result-item label { font-size: 12px; color: #666; }
    .result-item span { font-size: 16px; font-weight: 500; }
    .result-item .large { font-size: 22px; font-weight: 700; }
    .result-item.highlight { background: #e3f2fd; }
    .changed { color: #e65100; }
    .change-notice { display: flex; align-items: center; gap: 8px; padding: 12px 16px; background: #fff3e0; border-radius: 8px; margin-bottom: 24px; font-size: 14px; color: #e65100; }
    mat-divider { margin: 0 -24px 24px; }
    .actions { display: flex; justify-content: flex-end; }
    @media (max-width: 768px) {
      .month-cards { grid-template-columns: 1fr; }
      .result-grid { grid-template-columns: 1fr 1fr; }
    }
  `],
})
export class SanteiDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private functions = inject(Functions);
  private snackBar = inject(MatSnackBar);
  private auth = inject(AuthService);

  employeeName = signal('');
  monthData = signal<MonthData[]>([]);
  loading = signal(false);
  confirming = signal(false);
  average = signal(0);
  currentGrade = signal(0);
  proposedGrade = signal(0);
  gradeChanged = signal(false);
  validMonthCount = signal(0);

  private employeeId = '';

  ngOnInit() {
    this.employeeId = this.route.snapshot.paramMap.get('employeeId') ?? '';
    this.loadData();
  }

  goBack() {
    this.router.navigate(['/santei']);
  }

  async confirmGrade() {
    this.confirming.set(true);
    try {
      const year = new Date().getFullYear();
      const fn = httpsCallable(this.functions, 'gradeCreate');
      await fn({
        companyId: this.auth.companyId,
        employeeId: this.employeeId,
        effectiveMonth: `${year}-09`,
        determinationType: 'regular',
        healthGradeNumber: this.proposedGrade(),
        healthStandardRemuneration: this.average(),
        pensionGradeNumber: this.proposedGrade(),
        pensionStandardRemuneration: this.average(),
        reason: '算定基礎届による定時決定',
      });
      this.snackBar.open('等級を確定しました', '閉じる', { duration: 3000 });
      this.goBack();
    } catch (e: any) {
      this.snackBar.open(`エラー: ${e.message}`, '閉じる', { duration: 5000 });
    } finally {
      this.confirming.set(false);
    }
  }

  private async loadData() {
    this.loading.set(true);
    const year = new Date().getFullYear();
    try {
      const fn = httpsCallable<any, any>(this.functions, 'employeeGet');
      const empResult = await fn({
        companyId: this.auth.companyId,
        employeeId: this.employeeId,
      });
      this.employeeName.set(`${empResult.data.lastName} ${empResult.data.firstName}`);

      const months = [
        { ym: `${year}-04`, label: '4月' },
        { ym: `${year}-05`, label: '5月' },
        { ym: `${year}-06`, label: '6月' },
      ];
      const data: MonthData[] = [];

      for (const m of months) {
        const salaryFn = httpsCallable<any, any>(this.functions, 'salaryList');
        const result = await salaryFn({
          companyId: this.auth.companyId,
          yearMonth: m.ym,
          limit: 200,
        });
        const items: any[] = result.data.items ?? [];
        const match = items.find((i: any) => i.employeeId === this.employeeId);
        const basisDays = match?.paymentBasisDays ?? 0;
        data.push({
          yearMonth: m.ym,
          label: m.label,
          totalSalary: match?.totalSalary ?? 0,
          baseSalary: match?.baseSalary ?? 0,
          paymentBasisDays: basisDays,
          isValid: basisDays >= 17,
        });
      }

      this.monthData.set(data);
      const validData = data.filter((d) => d.isValid && d.totalSalary > 0);
      this.validMonthCount.set(validData.length);
      const avg = validData.length > 0
        ? Math.round(validData.reduce((s, d) => s + d.totalSalary, 0) / validData.length)
        : 0;
      this.average.set(avg);
      const current = this.estimateGrade(avg > 0 ? avg * 0.8 : 0);
      const proposed = this.estimateGrade(avg);
      this.currentGrade.set(current);
      this.proposedGrade.set(proposed);
      this.gradeChanged.set(current !== proposed);
    } catch {
      this.monthData.set([]);
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
