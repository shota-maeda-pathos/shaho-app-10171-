import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatListModule } from '@angular/material/list';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../core/services/auth.service';

interface PayslipSummary {
  yearMonth: string;
  totalSalary: number;
  totalPremium: number;
  netAmount: number;
}

@Component({
  selector: 'app-portal',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule, MatIconModule, MatCardModule, MatListModule,
    MatProgressSpinnerModule, MatDividerModule,
  ],
  template: `
    <div class="page-container">
      <div class="page-header">
        <h1>マイポータル</h1>
      </div>

      <div class="portal-grid">
        <mat-card class="profile-card">
          <div class="profile-header">
            <mat-icon class="profile-icon">account_circle</mat-icon>
            <div>
              <h2>{{ employeeName() }}</h2>
              <p class="subtitle">{{ departmentName() }}</p>
            </div>
          </div>
          <mat-divider></mat-divider>
          <div class="profile-details">
            <div class="detail-row">
              <span class="detail-label">社員番号</span>
              <span>{{ employeeNumber() }}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">入社日</span>
              <span>{{ hireDate() }}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">事業所</span>
              <span>{{ officeName() }}</span>
            </div>
          </div>
        </mat-card>

        <mat-card class="payslip-card">
          <h2>給与明細</h2>
          @if (loading()) {
            <div class="loading-container"><mat-spinner diameter="32"></mat-spinner></div>
          } @else if (payslips().length === 0) {
            <div class="empty-state">
              <mat-icon>receipt_long</mat-icon>
              <p>明細がありません</p>
            </div>
          } @else {
            <mat-list>
              @for (slip of payslips(); track slip.yearMonth) {
                <mat-list-item class="payslip-item" (click)="viewPayslip(slip.yearMonth)">
                  <mat-icon matListItemIcon>description</mat-icon>
                  <div matListItemTitle>{{ slip.yearMonth }}</div>
                  <div matListItemLine>
                    支給: {{ slip.totalSalary | number }}円 / 控除: {{ slip.totalPremium | number }}円 / 手取: {{ slip.netAmount | number }}円
                  </div>
                  <mat-icon matListItemMeta>chevron_right</mat-icon>
                </mat-list-item>
              }
            </mat-list>
          }
        </mat-card>
      </div>

      <div class="info-cards">
        <mat-card class="info-card" (click)="viewSection('dependents')">
          <mat-icon>family_restroom</mat-icon>
          <span>扶養家族</span>
          <mat-icon class="chevron">chevron_right</mat-icon>
        </mat-card>
        <mat-card class="info-card" (click)="viewSection('insurance')">
          <mat-icon>security</mat-icon>
          <span>保険情報</span>
          <mat-icon class="chevron">chevron_right</mat-icon>
        </mat-card>
        <mat-card class="info-card" (click)="viewSection('filings')">
          <mat-icon>description</mat-icon>
          <span>届出履歴</span>
          <mat-icon class="chevron">chevron_right</mat-icon>
        </mat-card>
      </div>
    </div>
  `,
  styles: [`
    .page-container { padding: 24px; }
    .page-header { margin-bottom: 24px; }
    .page-header h1 { margin: 0; font-size: 24px; font-weight: 500; }
    .portal-grid { display: grid; grid-template-columns: 1fr 2fr; gap: 16px; margin-bottom: 16px; }
    .profile-card { padding: 24px; }
    .profile-header { display: flex; align-items: center; gap: 16px; margin-bottom: 16px; }
    .profile-icon { font-size: 56px; width: 56px; height: 56px; color: #1976d2; }
    .profile-header h2 { margin: 0; font-size: 20px; }
    .subtitle { margin: 4px 0 0; color: #666; font-size: 14px; }
    .profile-details { padding-top: 16px; }
    .detail-row { display: flex; justify-content: space-between; padding: 8px 0; font-size: 14px; }
    .detail-label { color: #666; }
    .payslip-card { padding: 24px; }
    .payslip-card h2 { margin: 0 0 16px; font-size: 16px; font-weight: 500; }
    .payslip-item { cursor: pointer; }
    .loading-container { display: flex; justify-content: center; padding: 32px; }
    .empty-state { text-align: center; padding: 32px; color: #666; }
    .empty-state mat-icon { font-size: 40px; width: 40px; height: 40px; color: #ccc; }
    .info-cards { display: flex; gap: 16px; }
    .info-card { flex: 1; padding: 20px; display: flex; align-items: center; gap: 12px; cursor: pointer; transition: box-shadow 0.2s; }
    .info-card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
    .info-card mat-icon { color: #1976d2; }
    .info-card span { flex: 1; font-size: 14px; font-weight: 500; }
    .chevron { color: #999; }
    mat-divider { margin: 0 -24px; }
    @media (max-width: 768px) {
      .portal-grid { grid-template-columns: 1fr; }
      .info-cards { flex-direction: column; }
    }
  `],
})
export class PortalComponent implements OnInit {
  private router = inject(Router);
  private functions = inject(Functions);
  private auth = inject(AuthService);

  employeeName = signal('');
  employeeNumber = signal('');
  departmentName = signal('');
  officeName = signal('');
  hireDate = signal('');
  payslips = signal<PayslipSummary[]>([]);
  loading = signal(false);

  ngOnInit() {
    this.loadProfile();
    this.loadPayslips();
  }

  viewPayslip(yearMonth: string) {
    this.router.navigate(['/portal/payslip', yearMonth]);
  }

  viewSection(section: string) {
    const profile = this.auth.profile();
    if (!profile?.employeeId) return;
    if (section === 'dependents') {
      this.router.navigate(['/employees', profile.employeeId]);
    } else if (section === 'filings') {
      this.router.navigate(['/filings']);
    } else if (section === 'insurance') {
      this.router.navigate(['/premium/monthly']);
    }
  }

  private async loadProfile() {
    const profile = this.auth.profile();
    if (!profile?.employeeId) {
      this.employeeName.set(profile?.displayName ?? '');
      return;
    }
    try {
      const fn = httpsCallable<any, any>(this.functions, 'employeeGet');
      const result = await fn({
        companyId: this.auth.companyId,
        employeeId: profile.employeeId,
      });
      const emp = result.data;
      this.employeeName.set(`${emp.lastName} ${emp.firstName}`);
      this.employeeNumber.set(emp.employeeNumber);
      this.hireDate.set(emp.hireDate ?? '');
      this.officeName.set(emp.officeName ?? emp.officeId ?? '');
      this.departmentName.set(emp.departmentName ?? '');
    } catch {
      this.employeeName.set(profile?.displayName ?? '');
    }
  }

  private async loadPayslips() {
    this.loading.set(true);
    const profile = this.auth.profile();
    if (!profile?.employeeId) {
      this.loading.set(false);
      return;
    }
    try {
      const months = this.getRecentMonths(6);
      const slips: PayslipSummary[] = [];
      for (const ym of months) {
        const fn = httpsCallable<any, any>(this.functions, 'salaryList');
        const result = await fn({
          companyId: this.auth.companyId,
          yearMonth: ym,
        });
        const items: any[] = result.data.items ?? [];
        const match = items.find((i: any) => i.employeeId === profile.employeeId);
        if (match && match.isConfirmed) {
          const premium = Math.round(match.totalSalary * 0.15);
          slips.push({
            yearMonth: ym,
            totalSalary: match.totalSalary,
            totalPremium: premium,
            netAmount: match.totalSalary - premium,
          });
        }
      }
      this.payslips.set(slips);
    } catch {
      this.payslips.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  private getRecentMonths(count: number): string[] {
    const months: string[] = [];
    const now = new Date();
    for (let i = 0; i < count; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    return months;
  }
}
