import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatListModule } from '@angular/material/list';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../../core/services/auth.service';

interface Notification {
  id: string;
  title: string;
  body: string;
  category: string;
  targetType: string;
  targetId?: string;
  createdAt: string;
}

@Component({
  selector: 'app-notification-management',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    MatIconModule, MatCardModule, MatSnackBarModule, MatListModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <div class="notification-mgmt">
      <mat-card class="create-card">
        <h3>お知らせ作成</h3>
        <form #form="ngForm" (ngSubmit)="create()">
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>タイトル</mat-label>
            <input matInput name="title" [(ngModel)]="title" required maxlength="200">
          </mat-form-field>
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>本文</mat-label>
            <textarea matInput name="body" [(ngModel)]="body" required maxlength="2000" rows="3"></textarea>
          </mat-form-field>
          <div class="form-row">
            <mat-form-field appearance="outline">
              <mat-label>カテゴリ</mat-label>
              <mat-select name="category" [(ngModel)]="category">
                <mat-option value="info">お知らせ</mat-option>
                <mat-option value="warning">注意</mat-option>
                <mat-option value="action">要対応</mat-option>
                <mat-option value="system">システム</mat-option>
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>対象</mat-label>
              <mat-select name="targetType" [(ngModel)]="targetType">
                <mat-option value="all">全員</mat-option>
                <mat-option value="office">事業所指定</mat-option>
                <mat-option value="employee">個人指定</mat-option>
              </mat-select>
            </mat-form-field>
            @if (targetType === 'office') {
              <mat-form-field appearance="outline">
                <mat-label>対象事業所</mat-label>
                <mat-select name="targetId" [(ngModel)]="targetId" required>
                  @for (o of offices(); track o.id) {
                    <mat-option [value]="o.id">{{ o.name }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
            }
            @if (targetType === 'employee') {
              <mat-form-field appearance="outline">
                <mat-label>氏名・カナ・社員番号で探す</mat-label>
                <input matInput name="employeeKeyword" [(ngModel)]="employeeKeyword" (keydown.enter)="$event.preventDefault(); searchEmployees()">
                <button mat-icon-button matSuffix type="button" (click)="searchEmployees()" aria-label="従業員を探す"><mat-icon>search</mat-icon></button>
                <mat-hint>{{ employeeHint() }}</mat-hint>
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>対象従業員</mat-label>
                <mat-select name="targetId" [(ngModel)]="targetId" required>
                  @for (emp of employees(); track emp.id) {
                    <mat-option [value]="emp.id">{{ emp.number }} - {{ emp.name }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
            }
          </div>
          <button mat-flat-button color="primary" type="submit"
            [disabled]="form.invalid || sending() || (targetType !== 'all' && !targetId)">
            {{ sending() ? '送信中...' : 'お知らせを作成' }}
          </button>
        </form>
      </mat-card>

      <h3>送信済みお知らせ</h3>
      @if (loadingList()) {
        <div class="loading"><mat-spinner diameter="24"></mat-spinner></div>
      }
      @if (notifications().length === 0 && !loadingList()) {
        <p class="empty">送信済みのお知らせはありません</p>
      }
      <mat-list>
        @for (n of notifications(); track n.id) {
          <mat-list-item>
            <mat-icon matListItemIcon>
              {{ n.category === 'warning' ? 'warning' : n.category === 'action' ? 'assignment' : 'info' }}
            </mat-icon>
            <div matListItemTitle>{{ n.title }}</div>
            <div matListItemLine>{{ n.body | slice:0:80 }}{{ n.body.length > 80 ? '...' : '' }}</div>
            <div matListItemMeta>{{ n.createdAt | date:'yyyy/MM/dd HH:mm' }}</div>
          </mat-list-item>
        }
      </mat-list>
    </div>
  `,
  styles: [`
    .notification-mgmt { padding: 16px 0; }
    .create-card { padding: 24px; margin-bottom: 24px; }
    .create-card h3 { margin: 0 0 16px; font-size: 16px; font-weight: 500; }
    .full-width { width: 100%; }
    .form-row { display: flex; gap: 16px; flex-wrap: wrap; }
    .form-row mat-form-field { flex: 1; min-width: 160px; }
    .loading { display: flex; justify-content: center; padding: 16px; }
    .empty { color: #666; font-size: 14px; }
    h3 { font-size: 16px; font-weight: 500; margin: 16px 0; }
  `],
})
export class NotificationManagementComponent implements OnInit {
  private functions = inject(Functions);
  private auth = inject(AuthService);
  private snackBar = inject(MatSnackBar);

  title = '';
  body = '';
  category = 'info';
  targetType = 'all';
  targetId = '';
  sending = signal(false);
  notifications = signal<Notification[]>([]);
  loadingList = signal(false);
  offices = signal<{ id: string; name: string }[]>([]);
  employees = signal<{ id: string; name: string; number: string }[]>([]);
  employeeKeyword = '';
  employeeHint = signal('');

  ngOnInit() {
    void this.loadNotifications();
    void this.loadOfficesAndEmployees();
  }

  private async loadOfficesAndEmployees() {
    try {
      const officeFn = httpsCallable<any, any>(this.functions, 'officeList');
      const { data: oData } = await officeFn({ companyId: this.auth.companyId });
      this.offices.set((oData.items ?? []).map((o: any) => ({ id: o.id, name: o.name })));
    } catch { /* silent */ }
    await this.searchEmployees();
  }

  /**
   * 個人指定の対象の候補を探す。全員を読み込むと人数が多い会社で重いので、
   * 検索語で絞って最大50人を出す（検索語が空なら社員番号順の先頭から）
   */
  async searchEmployees() {
    const keyword = this.employeeKeyword.trim();
    try {
      const empFn = httpsCallable<any, any>(this.functions, 'employeeList');
      const { data: eData } = await empFn({ companyId: this.auth.companyId, limit: 50, ...(keyword ? { keyword } : {}) });
      const found = (eData.items ?? []).map((e: any) => ({
        id: e.id, name: `${e.lastName} ${e.firstName}`, number: e.employeeNumber || '-',
      }));
      // 選んでいる人は、探し直しても候補に残す
      const selected = this.employees().find(e => e.id === this.targetId);
      this.employees.set(selected && !found.some((e: { id: string }) => e.id === selected.id) ? [selected, ...found] : found);
      const total = eData.total ?? found.length;
      this.employeeHint.set(total > found.length ? `${total}人のうち${found.length}人を表示しています。氏名や社員番号で絞り込んでください` : `${found.length}人が見つかりました`);
    } catch {
      this.employeeHint.set('従業員を読み込めませんでした');
    }
  }

  async create() {
    if (this.sending()) return;
    this.sending.set(true);
    try {
      const fn = httpsCallable(this.functions, 'notificationCreate');
      await fn({
        companyId: this.auth.companyId,
        title: this.title, body: this.body,
        category: this.category, targetType: this.targetType,
        ...(this.targetType !== 'all' ? { targetId: this.targetId } : {}),
      });
      this.snackBar.open('お知らせを作成しました', '閉じる', { duration: 3000 });
      this.title = ''; this.body = ''; this.targetId = '';
      void this.loadNotifications();
    } catch (e: any) {
      this.snackBar.open(`作成に失敗しました：${e.message ?? ''}`, '閉じる', { duration: 5000 });
    } finally { this.sending.set(false); }
  }

  async loadNotifications() {
    this.loadingList.set(true);
    try {
      const fn = httpsCallable<object, { notifications: Notification[] }>(this.functions, 'notificationList');
      const { data } = await fn({ companyId: this.auth.companyId, limit: 20 });
      this.notifications.set(data.notifications ?? []);
    } catch { /* silent */ }
    finally { this.loadingList.set(false); }
  }
}
