import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatChipsModule } from '@angular/material/chips';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../../core/services/auth.service';

interface RevisionResult {
  eligible: boolean;
  employeeId: string;
  employeeName: string;
  changeMonth: string;
  months: { yearMonth: string; totalSalary: number; paymentBasisDays: number }[];
  averageSalary: number | null;
  currentHealthGrade: number | null;
  currentPensionGrade: number | null;
  currentHealthStandardRemuneration: number | null;
  currentPensionStandardRemuneration: number | null;
  newHealthGrade: number | null;
  newPensionGrade: number | null;
  newHealthStandardRemuneration: number | null;
  newPensionStandardRemuneration: number | null;
  healthGradeDiff: number | null;
  pensionGradeDiff: number | null;
  effectiveMonth: string | null;
  reasons: string[];
  failReasons: string[];
}

@Component({
  selector: 'app-grade-revision',
  standalone: true,
  imports: [
    CommonModule, DecimalPipe, FormsModule, RouterLink,
    MatCardModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MatIconModule, MatProgressSpinnerModule,
    MatSnackBarModule, MatTableModule, MatChipsModule,
  ],
  template: `
    <div class="page-header">
      <button mat-icon-button [routerLink]="['/employees', employeeId]">
        <mat-icon>arrow_back</mat-icon>
      </button>
      <h1>随時改定判定</h1>
    </div>

    <mat-card class="check-card">
      <mat-card-content>
        <p class="desc">固定的賃金に変動があった月を指定し、随時改定の要否を判定します。</p>
        <div class="check-form">
          <mat-form-field appearance="outline">
            <mat-label>変動月 (YYYY-MM)</mat-label>
            <input matInput [(ngModel)]="changeMonth" name="changeMonth" placeholder="2026-04" required>
          </mat-form-field>
          <button mat-flat-button color="primary" (click)="check()" [disabled]="checking() || !changeMonth">
            @if (checking()) { <mat-spinner diameter="20"></mat-spinner> } @else { 判定実行 }
          </button>
        </div>
      </mat-card-content>
    </mat-card>

    @if (result()) {
      <mat-card class="result-card" [class.eligible]="result()!.eligible" [class.ineligible]="!result()!.eligible">
        <mat-card-content>
          <div class="result-header">
            <mat-icon>{{ result()!.eligible ? 'check_circle' : 'cancel' }}</mat-icon>
            <h2>{{ result()!.eligible ? '随時改定が必要です' : '随時改定の対象外です' }}</h2>
          </div>
          <p class="employee-name">{{ result()!.employeeName }} （変動月: {{ result()!.changeMonth }}）</p>

          @if (result()!.months.length > 0) {
            <h3>3か月の報酬</h3>
            <table mat-table [dataSource]="result()!.months" class="month-table">
              <ng-container matColumnDef="yearMonth">
                <th mat-header-cell *matHeaderCellDef>年月</th>
                <td mat-cell *matCellDef="let m">{{ m.yearMonth }}</td>
              </ng-container>
              <ng-container matColumnDef="totalSalary">
                <th mat-header-cell *matHeaderCellDef>報酬月額</th>
                <td mat-cell *matCellDef="let m">{{ m.totalSalary | number }}円</td>
              </ng-container>
              <ng-container matColumnDef="paymentBasisDays">
                <th mat-header-cell *matHeaderCellDef>支払基礎日数</th>
                <td mat-cell *matCellDef="let m">{{ m.paymentBasisDays }}日</td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="monthColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: monthColumns"></tr>
            </table>

            @if (result()!.averageSalary != null) {
              <p class="average">3か月平均: <strong>{{ result()!.averageSalary | number }}円</strong></p>
            }
          }

          @if (result()!.eligible) {
            <div class="grade-compare">
              <div class="grade-box">
                <h4>現行等級</h4>
                <p>健保 {{ result()!.currentHealthGrade }}等級 ({{ result()!.currentHealthStandardRemuneration | number }}円)</p>
                <p>厚年 {{ result()!.currentPensionGrade }}等級 ({{ result()!.currentPensionStandardRemuneration | number }}円)</p>
              </div>
              <mat-icon class="arrow">arrow_forward</mat-icon>
              <div class="grade-box new">
                <h4>新等級</h4>
                <p>健保 {{ result()!.newHealthGrade }}等級 ({{ result()!.newHealthStandardRemuneration | number }}円)</p>
                <p>厚年 {{ result()!.newPensionGrade }}等級 ({{ result()!.newPensionStandardRemuneration | number }}円)</p>
              </div>
            </div>
            <p class="effective">適用月: <strong>{{ result()!.effectiveMonth }}</strong></p>
            <div class="result-actions">
              <button mat-flat-button color="primary" (click)="confirmRevision()" [disabled]="confirming()">
                @if (confirming()) { <mat-spinner diameter="20"></mat-spinner> } @else { 改定を確定して月額変更届を生成 }
              </button>
            </div>
          }

          @if (result()!.failReasons.length > 0) {
            <div class="fail-reasons">
              <h3>判定不可の理由</h3>
              @for (r of result()!.failReasons; track r) {
                <p class="fail-item">{{ r }}</p>
              }
            </div>
          }
        </mat-card-content>
      </mat-card>
    }
  `,
  styles: [`
    .page-header { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
    h1 { margin: 0; font-size: 24px; }
    .check-card { margin-bottom: 24px; }
    .desc { color: rgba(0,0,0,.6); font-size: 14px; margin: 0 0 16px; }
    .check-form { display: flex; gap: 16px; align-items: flex-start; }
    .result-card { margin-bottom: 24px; }
    .result-card.eligible { border-left: 4px solid #4caf50; }
    .result-card.ineligible { border-left: 4px solid #9e9e9e; }
    .result-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .result-header mat-icon { font-size: 28px; width: 28px; height: 28px; }
    .eligible .result-header mat-icon { color: #4caf50; }
    .ineligible .result-header mat-icon { color: #9e9e9e; }
    .result-header h2 { margin: 0; font-size: 18px; }
    .employee-name { color: rgba(0,0,0,.6); margin: 0 0 16px; }
    h3 { font-size: 14px; font-weight: 500; margin: 16px 0 8px; }
    .month-table { width: 100%; margin-bottom: 8px; }
    .average { font-size: 15px; margin: 8px 0 16px; }
    .grade-compare { display: flex; align-items: center; gap: 16px; margin: 16px 0; }
    .grade-box { padding: 16px; border-radius: 8px; background: rgba(0,0,0,.04); flex: 1; }
    .grade-box.new { background: rgba(76,175,80,.08); }
    .grade-box h4 { margin: 0 0 8px; font-size: 13px; color: rgba(0,0,0,.6); }
    .grade-box p { margin: 4px 0; font-size: 14px; }
    .arrow { color: rgba(0,0,0,.3); }
    .effective { font-size: 15px; margin: 8px 0; }
    .result-actions { margin-top: 16px; }
    .fail-reasons { margin-top: 16px; padding: 12px; background: rgba(0,0,0,.03); border-radius: 8px; }
    .fail-item { margin: 4px 0; font-size: 13px; color: rgba(0,0,0,.6); }
    .fail-item::before { content: '• '; }
  `],
})
export class GradeRevisionComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private functions = inject(Functions);
  private auth = inject(AuthService);
  private snackBar = inject(MatSnackBar);

  employeeId = '';
  changeMonth = '';
  checking = signal(false);
  confirming = signal(false);
  result = signal<RevisionResult | null>(null);
  monthColumns = ['yearMonth', 'totalSalary', 'paymentBasisDays'];

  ngOnInit() {
    this.employeeId = this.route.snapshot.paramMap.get('id') ?? '';
  }

  async check() {
    if (this.checking() || !this.changeMonth) return;
    this.checking.set(true);
    this.result.set(null);
    try {
      const fn = httpsCallable<object, RevisionResult>(this.functions, 'gradeRevisionCheck');
      const { data } = await fn({
        companyId: this.auth.companyId,
        employeeId: this.employeeId,
        changeMonth: this.changeMonth,
      });
      this.result.set(data);
    } catch (e: any) {
      this.snackBar.open(`判定に失敗しました：${e.message ?? ''}`, '閉じる', { duration: 5000 });
    } finally {
      this.checking.set(false);
    }
  }

  async confirmRevision() {
    const r = this.result();
    if (!r || !r.eligible || this.confirming()) return;
    this.confirming.set(true);
    try {
      const gradeFn = httpsCallable(this.functions, 'gradeCreate');
      await gradeFn({
        companyId: this.auth.companyId,
        employeeId: this.employeeId,
        effectiveMonth: r.effectiveMonth,
        healthGradeNumber: r.newHealthGrade,
        healthStandardRemuneration: r.newHealthStandardRemuneration,
        pensionGradeNumber: r.newPensionGrade,
        pensionStandardRemuneration: r.newPensionStandardRemuneration,
        determinationType: 'occasional',
        reason: `随時改定 変動月${r.changeMonth} 3か月平均${r.averageSalary}円`,
      });

      const filingFn = httpsCallable(this.functions, 'filingAutoGenerate');
      await filingFn({
        companyId: this.auth.companyId,
        employeeId: this.employeeId,
        filingType: 'remunerationMonthlyChange',
        effectiveDate: `${r.effectiveMonth}-01`,
        yearMonth: r.changeMonth,
      });

      this.snackBar.open('改定を確定し、月額変更届を下書き生成しました', '閉じる', { duration: 5000 });
      this.router.navigate(['/filings']);
    } catch (e: any) {
      this.snackBar.open(`確定処理に失敗しました：${e.message ?? ''}`, '閉じる', { duration: 5000 });
    } finally {
      this.confirming.set(false);
    }
  }
}
