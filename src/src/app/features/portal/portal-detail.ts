import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-portal-detail',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule, MatIconModule, MatCardModule,
    MatDividerModule, MatProgressSpinnerModule,
  ],
  template: `
    <div class="page-container">
      <div class="page-header">
        <button mat-icon-button (click)="goBack()"><mat-icon>arrow_back</mat-icon></button>
        <h1>給与明細 — {{ yearMonth() }}</h1>
      </div>

      @if (loading()) {
        <div class="loading-container"><mat-spinner diameter="40"></mat-spinner></div>
      } @else if (salary()) {
        <mat-card class="payslip-card">
          <div class="payslip-header">
            <h2>{{ salary()!.employeeName }}</h2>
            <span class="period">{{ yearMonth() }}</span>
          </div>

          <mat-divider></mat-divider>

          <div class="section">
            <h3>支給</h3>
            <div class="line-item">
              <span>基本給</span>
              <span class="amount">{{ salary()!.baseSalary | number }} 円</span>
            </div>
            @if (salary()!.fixedAllowances) {
              @for (key of objectKeys(salary()!.fixedAllowances); track key) {
                <div class="line-item">
                  <span>{{ key }}</span>
                  <span class="amount">{{ salary()!.fixedAllowances[key] | number }} 円</span>
                </div>
              }
            }
            @if (salary()!.variableAllowances) {
              @for (key of objectKeys(salary()!.variableAllowances); track key) {
                <div class="line-item">
                  <span>{{ key }}</span>
                  <span class="amount">{{ salary()!.variableAllowances[key] | number }} 円</span>
                </div>
              }
            }
            <div class="line-item total">
              <span>支給合計</span>
              <span class="amount">{{ salary()!.totalSalary | number }} 円</span>
            </div>
          </div>

          <mat-divider></mat-divider>

          <div class="section">
            <h3>控除</h3>
            <div class="line-item">
              <span>健康保険料</span>
              <span class="amount">{{ healthPremium() | number }} 円</span>
            </div>
            <div class="line-item">
              <span>厚生年金保険料</span>
              <span class="amount">{{ pensionPremium() | number }} 円</span>
            </div>
            <div class="line-item total">
              <span>控除合計</span>
              <span class="amount">{{ totalDeduction() | number }} 円</span>
            </div>
          </div>

          <mat-divider></mat-divider>

          <div class="section net">
            <div class="line-item grand-total">
              <span>差引支給額</span>
              <span class="amount">{{ netAmount() | number }} 円</span>
            </div>
          </div>
        </mat-card>
      } @else {
        <mat-card class="empty-card">
          <div class="empty-state">
            <mat-icon>receipt_long</mat-icon>
            <p>明細が見つかりません</p>
          </div>
        </mat-card>
      }
    </div>
  `,
  styles: [`
    .page-container { padding: 24px; max-width: 640px; margin: 0 auto; }
    .page-header { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
    .page-header h1 { margin: 0; font-size: 24px; font-weight: 500; }
    .loading-container { display: flex; justify-content: center; padding: 48px; }
    .payslip-card { padding: 32px; }
    .payslip-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .payslip-header h2 { margin: 0; font-size: 20px; }
    .period { font-size: 16px; color: #666; }
    .section { padding: 16px 0; }
    .section h3 { margin: 0 0 12px; font-size: 14px; font-weight: 500; color: #666; text-transform: uppercase; letter-spacing: 1px; }
    .line-item { display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px; }
    .line-item.total { border-top: 1px solid #e0e0e0; padding-top: 12px; margin-top: 8px; font-weight: 600; }
    .line-item.grand-total { font-size: 20px; font-weight: 700; color: #1976d2; }
    .amount { font-family: 'Roboto Mono', monospace; }
    .empty-card { padding: 32px; }
    .empty-state { text-align: center; padding: 32px; color: #666; }
    .empty-state mat-icon { font-size: 48px; width: 48px; height: 48px; color: #ccc; }
    mat-divider { margin: 0 -32px; }
    .net { padding-top: 24px; }
  `],
})
export class PortalDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private functions = inject(Functions);
  private auth = inject(AuthService);

  yearMonth = signal('');
  salary = signal<any>(null);
  loading = signal(false);

  healthPremium = signal(0);
  pensionPremium = signal(0);
  totalDeduction = signal(0);
  netAmount = signal(0);

  objectKeys = Object.keys;

  ngOnInit() {
    this.yearMonth.set(this.route.snapshot.paramMap.get('id') ?? '');
    this.loadPayslip();
  }

  goBack() {
    this.router.navigate(['/portal']);
  }

  private async loadPayslip() {
    this.loading.set(true);
    const profile = this.auth.profile();
    if (!profile?.employeeId) {
      this.loading.set(false);
      return;
    }
    try {
      const fn = httpsCallable<any, any>(this.functions, 'salaryList');
      const result = await fn({
        companyId: this.auth.companyId,
        yearMonth: this.yearMonth(),
      });
      const items: any[] = result.data.items ?? [];
      const match = items.find((i: any) => i.employeeId === profile.employeeId);
      if (match) {
        this.salary.set(match);
        const health = Math.round(match.totalSalary * 0.05);
        const pension = Math.round(match.totalSalary * 0.09);
        this.healthPremium.set(health);
        this.pensionPremium.set(pension);
        this.totalDeduction.set(health + pension);
        this.netAmount.set(match.totalSalary - health - pension);
      }
    } catch {
      this.salary.set(null);
    } finally {
      this.loading.set(false);
    }
  }
}
