import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../core/services/auth.service';

interface DashboardStats {
  employeeCount: number;
  pendingApprovals: number;
  pendingFilings: number;
  uncollectedPremium: number;
}

interface TaskItem {
  icon: string;
  label: string;
  route: string;
  count: number;
  color: string;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule, MatIconModule, MatListModule,
    MatButtonModule, MatProgressSpinnerModule, MatDividerModule,
  ],
  template: `
    <div class="dashboard-container">
      <div class="welcome-section">
        <h1>ダッシュボード</h1>
        <p class="subtitle">{{ greeting() }}、{{ auth.profile()?.displayName ?? 'ユーザー' }}さん</p>
      </div>

      <div class="stats-row">
        <mat-card class="stat-card" (click)="navigate('/employees')">
          <mat-icon class="stat-icon" style="color: #1976d2">people</mat-icon>
          <div class="stat-value">{{ stats().employeeCount }}</div>
          <div class="stat-label">従業員数</div>
        </mat-card>
        <mat-card class="stat-card" (click)="navigate('/approvals')"
          [class.alert]="stats().pendingApprovals > 0">
          <mat-icon class="stat-icon" style="color: #e65100">pending_actions</mat-icon>
          <div class="stat-value">{{ stats().pendingApprovals }}</div>
          <div class="stat-label">承認待ち</div>
        </mat-card>
        <mat-card class="stat-card" (click)="navigate('/filings')"
          [class.alert]="stats().pendingFilings > 0">
          <mat-icon class="stat-icon" style="color: #2e7d32">description</mat-icon>
          <div class="stat-value">{{ stats().pendingFilings }}</div>
          <div class="stat-label">未提出届出</div>
        </mat-card>
        <mat-card class="stat-card" (click)="navigate('/premium/collection')">
          <mat-icon class="stat-icon" style="color: #7b1fa2">account_balance</mat-icon>
          <div class="stat-value">{{ stats().uncollectedPremium | number }}</div>
          <div class="stat-label">未徴収額（円）</div>
        </mat-card>
      </div>

      @if (auth.hasAnyRole('admin', 'operator')) {
        <div class="content-grid">
          <mat-card class="task-card">
            <h2>
              <mat-icon>assignment</mat-icon>
              今月のタスク
            </h2>
            @if (loading()) {
              <div class="loading"><mat-spinner diameter="32"></mat-spinner></div>
            } @else {
              <div class="task-list">
                @for (task of tasks(); track task.label) {
                  <div class="task-item" (click)="navigate(task.route)">
                    <mat-icon [style.color]="task.color">{{ task.icon }}</mat-icon>
                    <span class="task-label">{{ task.label }}</span>
                    @if (task.count > 0) {
                      <span class="task-badge" [style.background]="task.color">{{ task.count }}</span>
                    } @else {
                      <mat-icon class="task-done">check_circle</mat-icon>
                    }
                  </div>
                }
              </div>
            }
          </mat-card>

          <mat-card class="shortcut-card">
            <h2>
              <mat-icon>bolt</mat-icon>
              クイック操作
            </h2>
            <div class="shortcut-grid">
              <button mat-stroked-button (click)="navigate('/employees')">
                <mat-icon>person_add</mat-icon>
                従業員登録
              </button>
              <button mat-stroked-button (click)="navigate('/salary')">
                <mat-icon>payments</mat-icon>
                給与入力
              </button>
              <button mat-stroked-button (click)="navigate('/premium/monthly')">
                <mat-icon>calculate</mat-icon>
                保険料計算
              </button>
              <button mat-stroked-button (click)="navigate('/filings')">
                <mat-icon>description</mat-icon>
                届出管理
              </button>
              <button mat-stroked-button (click)="navigate('/santei')">
                <mat-icon>assessment</mat-icon>
                算定基礎届
              </button>
              <button mat-stroked-button (click)="navigate('/settings')">
                <mat-icon>manage_accounts</mat-icon>
                ユーザー管理
              </button>
            </div>
          </mat-card>
        </div>
      }

      @if (auth.hasRole('employee')) {
        <mat-card class="portal-banner" (click)="navigate('/portal')">
          <mat-icon>account_circle</mat-icon>
          <div>
            <h3>マイポータル</h3>
            <p>給与明細や保険情報を確認できます</p>
          </div>
          <mat-icon class="chevron">chevron_right</mat-icon>
        </mat-card>
      }
    </div>
  `,
  styles: [`
    .dashboard-container { padding: 24px; }
    .welcome-section { margin-bottom: 24px; }
    .welcome-section h1 { margin: 0; font-size: 28px; font-weight: 500; }
    .subtitle { margin: 4px 0 0; color: #666; font-size: 14px; }
    .stats-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }
    .stat-card { padding: 20px; text-align: center; cursor: pointer; transition: box-shadow 0.2s, transform 0.2s; }
    .stat-card:hover { box-shadow: 0 4px 16px rgba(0,0,0,0.12); transform: translateY(-2px); }
    .stat-card.alert { border-left: 4px solid #e65100; }
    .stat-icon { font-size: 32px; width: 32px; height: 32px; }
    .stat-value { font-size: 32px; font-weight: 700; margin: 8px 0 4px; }
    .stat-label { font-size: 12px; color: #666; }
    .content-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
    .task-card, .shortcut-card { padding: 24px; }
    h2 { display: flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 500; margin: 0 0 16px; }
    h2 mat-icon { color: #1976d2; font-size: 20px; width: 20px; height: 20px; }
    .loading { display: flex; justify-content: center; padding: 24px; }
    .task-list { display: flex; flex-direction: column; gap: 4px; }
    .task-item { display: flex; align-items: center; gap: 12px; padding: 12px; border-radius: 8px; cursor: pointer; transition: background 0.15s; }
    .task-item:hover { background: #f5f5f5; }
    .task-label { flex: 1; font-size: 14px; }
    .task-badge { color: #fff; padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: 600; }
    .task-done { color: #4caf50; font-size: 20px; width: 20px; height: 20px; }
    .shortcut-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .shortcut-grid button { justify-content: flex-start; gap: 8px; padding: 12px 16px; }
    .portal-banner { display: flex; align-items: center; gap: 16px; padding: 24px; cursor: pointer; transition: box-shadow 0.2s; }
    .portal-banner:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
    .portal-banner mat-icon:first-child { font-size: 48px; width: 48px; height: 48px; color: #1976d2; }
    .portal-banner h3 { margin: 0; font-size: 18px; }
    .portal-banner p { margin: 4px 0 0; color: #666; font-size: 14px; }
    .portal-banner .chevron { color: #999; margin-left: auto; }
    @media (max-width: 960px) {
      .stats-row { grid-template-columns: repeat(2, 1fr); }
      .content-grid { grid-template-columns: 1fr; }
    }
    @media (max-width: 600px) {
      .stats-row { grid-template-columns: 1fr; }
    }
  `],
})
export class DashboardComponent implements OnInit {
  auth = inject(AuthService);
  private router = inject(Router);
  private functions = inject(Functions);

  stats = signal<DashboardStats>({ employeeCount: 0, pendingApprovals: 0, pendingFilings: 0, uncollectedPremium: 0 });
  tasks = signal<TaskItem[]>([]);
  loading = signal(false);

  ngOnInit() {
    this.loadStats();
  }

  greeting(): string {
    const h = new Date().getHours();
    if (h < 12) return 'おはようございます';
    if (h < 18) return 'こんにちは';
    return 'お疲れさまです';
  }

  navigate(route: string) {
    this.router.navigate([route]);
  }

  private async loadStats() {
    this.loading.set(true);
    const companyId = this.auth.companyId;
    const currentMonth = this.getCurrentMonth();

    try {
      const [empResult, approvalResult, filingResult, salaryResult] = await Promise.all([
        httpsCallable<any, any>(this.functions, 'employeeList')({ companyId, limit: 1 }).catch(() => ({ data: { total: 0 } })),
        httpsCallable<any, any>(this.functions, 'approvalRequestList')({ companyId, status: 'pending' }).catch(() => ({ data: { items: [] } })),
        httpsCallable<any, any>(this.functions, 'filingList')({ companyId, submissionStatus: 'notSubmitted' }).catch(() => ({ data: { items: [] } })),
        httpsCallable<any, any>(this.functions, 'salaryList')({ companyId, yearMonth: currentMonth, limit: 200 }).catch(() => ({ data: { items: [] } })),
      ]);

      const employees = empResult.data.total ?? empResult.data.items?.length ?? 0;
      const pendingApprovals = approvalResult.data.items?.length ?? 0;
      const pendingFilings = filingResult.data.items?.length ?? 0;

      const salaryItems: any[] = salaryResult.data.items ?? [];
      const uncollected = salaryItems
        .filter((s: any) => !s.isConfirmed)
        .reduce((sum: number, s: any) => sum + Math.round(s.totalSalary * 0.15), 0);

      this.stats.set({
        employeeCount: employees,
        pendingApprovals,
        pendingFilings,
        uncollectedPremium: uncollected,
      });

      this.tasks.set([
        { icon: 'payments', label: '給与入力', route: '/salary', count: salaryItems.filter((s: any) => !s.isConfirmed).length, color: '#1976d2' },
        { icon: 'calculate', label: '保険料計算', route: '/premium/monthly', count: 0, color: '#2e7d32' },
        { icon: 'pending_actions', label: '承認処理', route: '/approvals', count: pendingApprovals, color: '#e65100' },
        { icon: 'description', label: '届出提出', route: '/filings', count: pendingFilings, color: '#7b1fa2' },
        { icon: 'account_balance', label: '徴収確認', route: '/premium/collection', count: uncollected > 0 ? 1 : 0, color: '#c62828' },
      ]);
    } catch {
      this.tasks.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  private getCurrentMonth(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
}
