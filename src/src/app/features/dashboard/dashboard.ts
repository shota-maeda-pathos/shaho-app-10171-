import { Component, inject, signal, effect } from '@angular/core';
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

interface FilingAlert {
  employeeId: string;
  employeeName: string;
  filingType: string;
  filingId: string;
  createdAt: string;
  daysElapsed: number;
}

interface UncollectedAlert {
  yearMonth: string;
  employeeId: string;
  employeeName: string;
  totalAmount: number;
}

interface DashboardAlerts {
  filingDeadlines: FilingAlert[];
  uncollectedPremiums: UncollectedAlert[];
  revisionCandidates: number;
}

interface DashboardStats {
  employeeCount: number;
  pendingApprovals: number;
  pendingFilings: number;
  activeLeaves: number;
  activeExemptions: number;
  alerts: DashboardAlerts;
}

interface TaskItem {
  icon: string;
  label: string;
  route: string;
  count: number;
  color: string;
}

interface MonthlyTrend {
  yearMonth: string;
  totalEmployee: number;
  totalEmployer: number;
  healthTotal: number;
  pensionTotal: number;
  employeeCount: number;
}

interface FilingStats {
  total: number;
  draft: number;
  pending: number;
  approved: number;
  submitted: number;
  accepted: number;
}

interface AnalyticsData {
  insuranceTrends: MonthlyTrend[];
  filingStats: FilingStats;
  recentFilings: { id: string; employeeId: string; employeeName: string; filingType: string; status: string; effectiveDate: string }[];
  monthOverMonth: { currentMonth: string; previousMonth: string; currentTotal: number; previousTotal: number; changePercent: number | null } | null;
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

      @if (auth.loading()) {
        <div class="loading"><mat-spinner diameter="32"></mat-spinner></div>
      } @else if (!auth.profile()) {
        <p role="alert">ユーザー情報を取得できません。会社への登録とアクセス権を管理者に確認してください。</p>
      }
      @if (auth.hasAnyRole('admin', 'operator')) {
      @if (error()) {
        <p role="alert">{{ error() }}</p>
        <button mat-stroked-button (click)="loadStats()">再読み込み</button>
      }
      @if (loading()) {
        <div class="loading"><mat-spinner diameter="32"></mat-spinner></div>
      }
      @if (stats(); as data) {
      <div class="stats-row">
        <mat-card class="stat-card" (click)="navigate('/employees')">
          <mat-icon class="stat-icon" style="color: #1976d2">people</mat-icon>
          <div class="stat-value">{{ data.employeeCount }}</div>
          <div class="stat-label">従業員数</div>
        </mat-card>
        <mat-card class="stat-card" (click)="navigate('/approvals')"
          [class.alert]="data.pendingApprovals > 0">
          <mat-icon class="stat-icon" style="color: #e65100">pending_actions</mat-icon>
          <div class="stat-value">{{ data.pendingApprovals }}</div>
          <div class="stat-label">承認待ち</div>
        </mat-card>
        <mat-card class="stat-card" (click)="navigate('/filings')"
          [class.alert]="data.pendingFilings > 0">
          <mat-icon class="stat-icon" style="color: #2e7d32">description</mat-icon>
          <div class="stat-value">{{ data.pendingFilings }}</div>
          <div class="stat-label">未提出届出</div>
        </mat-card>
        <mat-card class="stat-card">
          <mat-icon class="stat-icon" style="color: #7b1fa2">baby_changing_station</mat-icon>
          <div class="stat-value">{{ data.activeLeaves }}</div>
          <div class="stat-label">休業中</div>
        </mat-card>
      </div>

      <p>免除登録：{{ data.activeExemptions }}件</p>

      @if (data.alerts; as alerts) {
        @if (alerts.filingDeadlines.length > 0 || alerts.uncollectedPremiums.length > 0 || alerts.revisionCandidates > 0) {
        <div class="alerts-section">
          <h2><mat-icon>warning</mat-icon> 業務アラート</h2>
          <div class="alert-cards">
            @if (alerts.filingDeadlines.length > 0) {
              <mat-card class="alert-card filing-alert">
                <div class="alert-header">
                  <mat-icon>schedule</mat-icon>
                  <span>届出期限超過 ({{ alerts.filingDeadlines.length }}件)</span>
                </div>
                <div class="alert-body">
                  @for (f of alerts.filingDeadlines; track f.filingId) {
                    <div class="alert-row" (click)="navigate('/employees/' + f.employeeId + '/filings/' + f.filingId)">
                      <span class="alert-name">{{ f.employeeName }}</span>
                      <span class="alert-type">{{ filingTypeLabel(f.filingType) }}</span>
                      <span class="alert-days">{{ f.daysElapsed }}日経過</span>
                    </div>
                  }
                </div>
              </mat-card>
            }
            @if (alerts.uncollectedPremiums.length > 0) {
              <mat-card class="alert-card premium-alert">
                <div class="alert-header">
                  <mat-icon>account_balance_wallet</mat-icon>
                  <span>未徴収保険料 ({{ alerts.uncollectedPremiums.length }}件)</span>
                </div>
                <div class="alert-body">
                  @for (p of alerts.uncollectedPremiums; track p.employeeId + p.yearMonth) {
                    <div class="alert-row" (click)="navigate('/premium/collection')">
                      <span class="alert-name">{{ p.employeeName }}</span>
                      <span class="alert-type">{{ p.yearMonth }}</span>
                      <span class="alert-amount">{{ p.totalAmount | number }}円</span>
                    </div>
                  }
                </div>
              </mat-card>
            }
            @if (alerts.revisionCandidates > 0) {
              <mat-card class="alert-card revision-alert" (click)="navigate('/santei')">
                <div class="alert-header">
                  <mat-icon>swap_vert</mat-icon>
                  <span>随時改定候補者</span>
                </div>
                <div class="alert-body">
                  <p class="revision-count">{{ alerts.revisionCandidates }}名の従業員に固定的賃金の変動があります</p>
                </div>
              </mat-card>
            }
          </div>
        </div>
        }
      }
      }
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
              <button mat-stroked-button (click)="navigate('/premium/bonus')">
                <mat-icon>card_giftcard</mat-icon>
                賞与保険料
              </button>
              <button mat-stroked-button (click)="navigate('/filings')">
                <mat-icon>description</mat-icon>
                届出管理
              </button>
              <button mat-stroked-button (click)="navigate('/santei')">
                <mat-icon>assessment</mat-icon>
                算定基礎届
              </button>
              @if (auth.hasRole('admin')) {
              <button mat-stroked-button (click)="navigate('/settings')">
                <mat-icon>manage_accounts</mat-icon>
                ユーザー管理
              </button>
              }
            </div>
          </mat-card>
        </div>

        @if (analytics(); as a) {
          <div class="analytics-section">
            @if (a.monthOverMonth; as mom) {
              <div class="mom-row">
                <mat-card class="mom-card">
                  <div class="mom-label">前月比 ({{ mom.previousMonth }} → {{ mom.currentMonth }})</div>
                  <div class="mom-value" [class.up]="(mom.changePercent ?? 0) > 0" [class.down]="(mom.changePercent ?? 0) < 0">
                    {{ mom.changePercent !== null ? ((mom.changePercent > 0 ? '+' : '') + mom.changePercent + '%') : '—' }}
                  </div>
                  <div class="mom-detail">{{ mom.previousTotal | number }}円 → {{ mom.currentTotal | number }}円</div>
                </mat-card>
                <mat-card class="filing-stats-card">
                  <h3>届出ステータス</h3>
                  <div class="filing-stat-grid">
                    <div class="fs-item"><span class="fs-num">{{ a.filingStats.draft }}</span><span class="fs-label">下書き</span></div>
                    <div class="fs-item"><span class="fs-num">{{ a.filingStats.pending }}</span><span class="fs-label">承認待ち</span></div>
                    <div class="fs-item"><span class="fs-num">{{ a.filingStats.approved }}</span><span class="fs-label">承認済み</span></div>
                    <div class="fs-item"><span class="fs-num">{{ a.filingStats.submitted }}</span><span class="fs-label">提出済み</span></div>
                    <div class="fs-item"><span class="fs-num">{{ a.filingStats.accepted }}</span><span class="fs-label">受理</span></div>
                  </div>
                </mat-card>
              </div>
            }

            <mat-card class="trends-card">
              <h2><mat-icon>trending_up</mat-icon> 保険料推移（月別）</h2>
              <div class="trends-table-wrap">
                <table class="trends-table">
                  <thead>
                    <tr><th>年月</th><th>被保険者負担</th><th>事業主負担</th><th>健保計</th><th>厚年計</th><th>対象人数</th></tr>
                  </thead>
                  <tbody>
                    @for (t of a.insuranceTrends; track t.yearMonth) {
                      <tr>
                        <td>{{ t.yearMonth }}</td>
                        <td class="num">{{ t.totalEmployee | number }}</td>
                        <td class="num">{{ t.totalEmployer | number }}</td>
                        <td class="num">{{ t.healthTotal | number }}</td>
                        <td class="num">{{ t.pensionTotal | number }}</td>
                        <td class="num">{{ t.employeeCount }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </mat-card>

            @if (a.recentFilings.length > 0) {
              <mat-card class="recent-filings-card">
                <h2><mat-icon>history</mat-icon> 最近の届出</h2>
                <mat-list>
                  @for (f of a.recentFilings; track f.id) {
                    <mat-list-item (click)="navigate('/employees/' + f.employeeId + '/filings/' + f.id)">
                      <mat-icon matListItemIcon>description</mat-icon>
                      <div matListItemTitle>{{ f.employeeName }} — {{ f.filingType }}</div>
                      <div matListItemLine>{{ f.effectiveDate }} ／ {{ f.status }}</div>
                    </mat-list-item>
                  }
                </mat-list>
              </mat-card>
            }
          </div>
        }
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
    .alerts-section { margin-bottom: 24px; }
    .alerts-section h2 mat-icon { color: #e65100; }
    .alert-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; }
    .alert-card { padding: 16px; border-left: 4px solid #e65100; }
    .alert-card.premium-alert { border-left-color: #d32f2f; }
    .alert-card.revision-alert { border-left-color: #f57c00; cursor: pointer; }
    .alert-card.revision-alert:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
    .alert-header { display: flex; align-items: center; gap: 8px; font-weight: 500; font-size: 14px; margin-bottom: 12px; }
    .alert-header mat-icon { font-size: 20px; width: 20px; height: 20px; color: #e65100; }
    .premium-alert .alert-header mat-icon { color: #d32f2f; }
    .revision-alert .alert-header mat-icon { color: #f57c00; }
    .alert-body { display: flex; flex-direction: column; gap: 4px; }
    .alert-row { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 4px; cursor: pointer; font-size: 13px; }
    .alert-row:hover { background: #f5f5f5; }
    .alert-name { flex: 1; font-weight: 500; }
    .alert-type { color: #666; font-size: 12px; }
    .alert-days { color: #e65100; font-weight: 600; font-size: 12px; white-space: nowrap; }
    .alert-amount { color: #d32f2f; font-weight: 600; font-size: 12px; white-space: nowrap; }
    .revision-count { margin: 0; font-size: 13px; color: #666; }
    .analytics-section { margin-bottom: 24px; display: flex; flex-direction: column; gap: 16px; }
    .mom-row { display: grid; grid-template-columns: 1fr 2fr; gap: 16px; }
    .mom-card { padding: 24px; text-align: center; }
    .mom-label { font-size: 13px; color: #666; }
    .mom-value { font-size: 36px; font-weight: 700; margin: 8px 0; }
    .mom-value.up { color: #d32f2f; }
    .mom-value.down { color: #2e7d32; }
    .mom-detail { font-size: 13px; color: #888; }
    .filing-stats-card { padding: 24px; }
    .filing-stats-card h3 { margin: 0 0 16px; font-size: 15px; font-weight: 500; }
    .filing-stat-grid { display: flex; gap: 16px; flex-wrap: wrap; }
    .fs-item { text-align: center; flex: 1; min-width: 60px; }
    .fs-num { display: block; font-size: 24px; font-weight: 600; }
    .fs-label { font-size: 12px; color: #666; }
    .trends-card { padding: 24px; }
    .trends-table-wrap { overflow-x: auto; }
    .trends-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .trends-table th { text-align: left; padding: 8px 12px; border-bottom: 2px solid #e0e0e0; font-weight: 500; color: #666; font-size: 12px; }
    .trends-table td { padding: 8px 12px; border-bottom: 1px solid #f0f0f0; }
    .trends-table .num { text-align: right; font-variant-numeric: tabular-nums; }
    .recent-filings-card { padding: 24px; }
    .recent-filings-card mat-list-item { cursor: pointer; }
    @media (max-width: 960px) { .mom-row { grid-template-columns: 1fr; } }
    @media (max-width: 600px) {
      .stats-row { grid-template-columns: 1fr; }
    }
  `],
})
export class DashboardComponent  {
  auth = inject(AuthService);
  private router = inject(Router);
  private functions = inject(Functions);

  stats = signal<DashboardStats | null>(null);
  tasks = signal<TaskItem[]>([]);
  loading = signal(false);
  error = signal('');
  analytics = signal<AnalyticsData | null>(null);

  constructor() {
    effect(() => {
      const profile = this.auth.profile();
      if (!this.auth.loading() && profile && this.auth.hasAnyRole('admin', 'operator')) {
        void this.loadStats();
        void this.loadAnalytics();
      }
    });
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

  async loadStats() {
    this.loading.set(true);
    this.error.set('');
    this.stats.set(null);
    this.tasks.set([]);
    try {
      const fn = httpsCallable<{ companyId: string }, DashboardStats>(this.functions, 'dashboardStats');
      const { data } = await fn({ companyId: this.auth.companyId });
      this.stats.set(data);
      this.tasks.set([
        { icon: 'payments', label: '給与入力', route: '/salary', count: 0, color: '#1976d2' },
        { icon: 'calculate', label: '保険料計算', route: '/premium/monthly', count: 0, color: '#2e7d32' },
        { icon: 'pending_actions', label: '承認処理', route: '/approvals', count: data.pendingApprovals, color: '#e65100' },
        { icon: 'description', label: '届出提出', route: '/filings', count: data.pendingFilings, color: '#7b1fa2' },
      ]);
    } catch {
      this.error.set('統計情報を取得できませんでした。接続状況・権限・APIの公開状況を確認してください。');
    } finally {
      this.loading.set(false);
    }
  }

  private readonly FILING_TYPE_LABELS: Record<string, string> = {
    acquisitionNotification: '資格取得届',
    lossNotification: '資格喪失届',
    remunerationMonthlyChange: '月額変更届',
    remunerationMonthlyAlgorithm: '算定基礎届',
    bonusPayment: '賞与支払届',
    dependentChange: '扶養異動届',
    maternityLeaveStart: '産前産後休業取得者申出書',
    childcareLeaveStart: '育児休業等取得者申出書',
    childcareLeaveEnd: '育児休業等取得者終了届',
  };

  filingTypeLabel(type: string): string {
    return this.FILING_TYPE_LABELS[type] ?? type;
  }

  async loadAnalytics() {
    try {
      const fn = httpsCallable<{ companyId: string; months?: number }, AnalyticsData>(this.functions, 'dashboardAnalytics');
      const { data } = await fn({ companyId: this.auth.companyId, months: 6 });
      this.analytics.set(data);
    } catch { /* analytics is non-critical */ }
  }
}
