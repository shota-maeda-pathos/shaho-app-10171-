import { PortalProfile, PortalPayslip, PortalOverview, groupByYear } from './portal.types';
import { Component, computed, inject, signal, OnInit } from '@angular/core';
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
import { PortalInfoComponent } from './portal-info';
import { PortalRequestsComponent } from './portal-requests';

@Component({
  selector: 'app-portal',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule, MatIconModule, MatCardModule, MatListModule,
    MatProgressSpinnerModule, MatDividerModule, PortalInfoComponent, PortalRequestsComponent,
  ],
  template: `
    <div class="page-container">
      <div class="page-header"><h1>マイポータル</h1></div>
      @if (error()) {
        <p role="alert">{{ error() }}</p>
        <button mat-stroked-button (click)="load()" [disabled]="loading()">再読み込み</button>
      }
      @if (loading() && !profile()) {
        <div class="loading-container"><mat-spinner diameter="32" /></div>
      } @else if (linked() === false) {
        <mat-card class="profile-card"><p>従業員との紐付けがありません。管理者に確認してください。</p></mat-card>
      } @else if (profile(); as employee) {
        @if (notifications().length > 0) {
          <mat-card class="notifications-card">
            <div class="section-header">
              <h2><mat-icon>notifications</mat-icon> お知らせ</h2>
              @if (unreadCount() > 0) {
                <span class="unread-badge">{{ unreadCount() }}件未読</span>
              }
            </div>
            @for (n of notifications(); track n.id) {
              <div class="notification-item" [class.unread]="!n.isRead" (click)="markRead(n)">
                <mat-icon class="notif-icon" [class]="'cat-' + n.category">
                  {{ n.category === 'warning' ? 'warning' : n.category === 'action' ? 'assignment' : 'info' }}
                </mat-icon>
                <div class="notif-content">
                  <div class="notif-title">{{ n.title }}</div>
                  <div class="notif-body">{{ n.body }}</div>
                  <div class="notif-date">{{ n.createdAt | date:'yyyy/MM/dd HH:mm' }}</div>
                </div>
              </div>
            }
          </mat-card>
        }
        <div class="portal-grid">
          <mat-card class="profile-card">
            <div class="profile-header"><mat-icon class="profile-icon">account_circle</mat-icon>
              <div><h2>{{ employee.employeeName }}</h2><p>{{ employee.departmentName ?? '—' }}</p></div>
            </div>
            <div class="profile-details">
              <div class="detail-row"><span>社員番号</span><span>{{ employee.employeeNumber }}</span></div>
              <div class="detail-row"><span>入社日</span><span>{{ employee.hireDate ?? '—' }}</span></div>
              <div class="detail-row"><span>事業所</span><span>{{ employee.officeName ?? '—' }}</span></div>
              @if (!employee.isActive) { <p>退職後の閲覧用画面です。</p> }
            </div>
          </mat-card>
          <mat-card class="payslip-card">
            <h2>給与・社会保険料</h2>
            <p>承認済みの給与を表示します。社会保険料は、その月の給与から控除する保険料（翌月控除の事業所は前の月の分）の承認済み計算額で、実際の控除額とは異なる場合があります。</p>
            @if (payslips().length === 0 && !loading()) { <p>表示できる承認済み給与はありません。</p> }
            @for (group of payslipYears(); track group.year) {
              <details class="year" [open]="$first">
                <summary><span class="year-title">{{ group.year }}年</span><span class="year-sub">{{ group.items.length }}か月分</span></summary>
                <mat-list>
                  @for (slip of group.items; track slip.yearMonth) {
                    <mat-list-item class="payslip-item" (click)="viewPayslip(slip.yearMonth)">
                      <mat-icon matListItemIcon>description</mat-icon>
                      <div matListItemTitle>{{ slip.yearMonth }}</div>
                      <div matListItemLine>支給：{{ slip.totalSalary === null ? '未登録' : (slip.totalSalary | number) + ' 円' }} ／ 控除する保険料{{ slip.insurance ? '（' + premiumMonthLabel(slip.insurance.yearMonth) + '分）' : '' }}：{{ slip.insurance?.totalEmployee == null ? '未確定' : (slip.insurance!.totalEmployee | number) + ' 円' }}</div>
                    </mat-list-item>
                  }
                </mat-list>
              </details>
            }
            @if (hasMore()) { <button mat-stroked-button (click)="load(true)" [disabled]="loading()">{{ loading() ? '読み込み中...' : '過去の月を読み込む' }}</button> }
          </mat-card>
        </div>
        <app-portal-info />
        <app-portal-requests />
      }
    </div>
  `,
  styles: [`
    .page-container { padding: 24px; }
    .page-header { margin-bottom: 24px; }
    .page-header h1 { margin: 0; font-size: 24px; font-weight: 500; }
    /* minmax(0, …)：折り返さない明細の行でカードが画面より広がらないように */
    .portal-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); gap: 16px; margin-bottom: 16px; }
    /* スマートフォン（カタログ11章：レスポンシブ）。明細の行は折り返して金額まで見せる */
    @media (max-width: 720px) {
      .page-container { padding: 12px; } .portal-grid { grid-template-columns: minmax(0, 1fr); }
      .year .payslip-item { height: auto; padding-top: 8px; padding-bottom: 8px; }
      .year .payslip-item [matListItemLine] { white-space: normal; }
    }
    .profile-card { padding: 24px; }
    .profile-header { display: flex; align-items: center; gap: 16px; margin-bottom: 16px; }
    .profile-icon { font-size: 56px; width: 56px; height: 56px; color: var(--app-brand-strong); }
    .profile-header h2 { margin: 0; font-size: 20px; }
    .subtitle { margin: 4px 0 0; color: #666; font-size: 14px; }
    .profile-details { padding-top: 16px; }
    .detail-row { display: flex; justify-content: space-between; padding: 8px 0; font-size: 14px; }
    .detail-label { color: #666; }
    .payslip-card { padding: 24px; }
    .payslip-card h2 { margin: 0 0 16px; font-size: 16px; font-weight: 500; }
    .payslip-item { cursor: pointer; }
    /* 年ごとに開閉する（いちばん新しい年だけ開いておく） */
    .year { border-top: 1px solid var(--app-color-border); }
    .year summary { display: flex; align-items: baseline; gap: 12px; padding: 12px 4px; cursor: pointer; list-style: none; }
    .year summary::-webkit-details-marker { display: none; }
    .year summary::before { content: '▸'; color: var(--app-color-text-sub); width: 1em; }
    .year[open] summary::before { content: '▾'; }
    .year-title { font-weight: 600; }
    .year-sub { color: var(--app-color-text-sub); font-size: 13px; }
    .loading-container { display: flex; justify-content: center; padding: 32px; }
    .empty-state { text-align: center; padding: 32px; color: #666; }
    .empty-state mat-icon { font-size: 40px; width: 40px; height: 40px; color: #ccc; }
    .info-cards { display: flex; gap: 16px; }
    .info-card { flex: 1; padding: 20px; display: flex; align-items: center; gap: 12px; cursor: pointer; transition: box-shadow 0.2s; }
    .info-card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
    .info-card mat-icon { color: var(--app-brand-strong); }
    .info-card span { flex: 1; font-size: 14px; font-weight: 500; }
    .chevron { color: #999; }
    mat-divider { margin: 0 -24px; }
    .notifications-card { padding: 24px; margin-bottom: 16px; }
    .section-header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
    .section-header h2 { margin: 0; font-size: 16px; font-weight: 500; display: flex; align-items: center; gap: 8px; }
    .unread-badge { background: #d32f2f; color: #fff; border-radius: 12px; padding: 2px 10px; font-size: 12px; font-weight: 500; }
    .notification-item { display: flex; gap: 12px; padding: 12px; border-radius: 8px; cursor: pointer; transition: background 0.15s; }
    .notification-item:hover { background: rgba(0,0,0,0.04); }
    .notification-item.unread { background: rgba(25,118,210,0.06); }
    .notif-icon { margin-top: 2px; }
    .notif-icon.cat-warning { color: #ed6c02; }
    .notif-icon.cat-action { color: var(--app-brand-strong); }
    .notif-icon.cat-info { color: #2e7d32; }
    .notif-icon.cat-system { color: #666; }
    .notif-content { flex: 1; min-width: 0; }
    .notif-title { font-weight: 500; font-size: 14px; }
    .notif-body { color: #666; font-size: 13px; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .notif-date { color: #999; font-size: 12px; margin-top: 4px; }
    @media (max-width: 768px) {
      .portal-grid { grid-template-columns: minmax(0, 1fr); }
      .info-cards { flex-direction: column; }
    }
  `],
})
export class PortalComponent implements OnInit {
  private router = inject(Router);
  private functions = inject(Functions);
  private auth = inject(AuthService);

  profile = signal<PortalProfile | null>(null);
  payslips = signal<PortalPayslip[]>([]);
  payslipYears = computed(() => groupByYear(this.payslips()));
  linked = signal<boolean | null>(null);
  loading = signal(false);
  error = signal('');
  hasMore = signal(false);
  notifications = signal<{ id: string; title: string; body: string; category: string; createdAt: string; isRead: boolean }[]>([]);
  unreadCount = signal(0);
  private lastDocId: string | null = null;
  ngOnInit() { void this.load(); void this.loadNotifications(); }
  /** '2026-09' → '9月'（年が違うときは '2025年12月'） */
  premiumMonthLabel(ym: string) { return ym.slice(0, 4) === new Date().getFullYear().toString() ? `${Number(ym.slice(5, 7))}月` : `${ym.slice(0, 4)}年${Number(ym.slice(5, 7))}月`; }
  viewPayslip(yearMonth: string) { this.router.navigate(['/portal/payslip', yearMonth]); }

  async loadNotifications() {
    try {
      const fn = httpsCallable<object, any>(this.functions, 'notificationList');
      const { data } = await fn({ companyId: this.auth.companyId, limit: 10 });
      this.notifications.set(data.notifications ?? []);
      this.unreadCount.set(data.unreadCount ?? 0);
    } catch { /* silent */ }
  }

  async markRead(n: { id: string; isRead: boolean }) {
    if (n.isRead) return;
    try {
      const fn = httpsCallable(this.functions, 'notificationMarkRead');
      await fn({ companyId: this.auth.companyId, notificationIds: [n.id] });
      this.notifications.update(list => list.map(x => x.id === n.id ? { ...x, isRead: true } : x));
      this.unreadCount.update(c => Math.max(0, c - 1));
    } catch { /* silent */ }
  }

  async load(append = false) {
    if (this.loading()) return;
    this.loading.set(true); this.error.set('');
    try {
      const fn = httpsCallable<object, PortalOverview>(this.functions, 'portalOverview');
      const { data } = await fn({ companyId: this.auth.companyId, limit: 12, ...(append && this.lastDocId ? { lastDocId: this.lastDocId } : {}) });
      this.linked.set(data.linked); this.profile.set(data.profile);
      this.payslips.set(append ? [...this.payslips(), ...data.payslips] : data.payslips);
      this.hasMore.set(data.hasMore); this.lastDocId = data.lastDocId;
    } catch (e: any) {
      this.error.set(`本人情報を取得できませんでした：${e.message ?? '再読み込みしてください'}`);
    } finally { this.loading.set(false); }
  }
}
