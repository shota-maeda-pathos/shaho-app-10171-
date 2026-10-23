import { Component, inject } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [MatCardModule, MatIconModule, MatListModule],
  template: `
    <h1>ダッシュボード</h1>
    <div class="dashboard-grid">
      <mat-card>
        <mat-card-header>
          <mat-icon mat-card-avatar>person</mat-icon>
          <mat-card-title>ようこそ</mat-card-title>
          <mat-card-subtitle>{{ auth.profile()?.displayName }}</mat-card-subtitle>
        </mat-card-header>
        <mat-card-content>
          <p>ロール: {{ auth.profile()?.roles?.join(', ') }}</p>
        </mat-card-content>
      </mat-card>

      @if (auth.hasAnyRole('admin', 'operator')) {
        <mat-card>
          <mat-card-header>
            <mat-icon mat-card-avatar>assignment</mat-icon>
            <mat-card-title>今月のタスク</mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <mat-list>
              <mat-list-item>
                <mat-icon matListItemIcon>check_circle_outline</mat-icon>
                <span matListItemTitle>給与入力</span>
              </mat-list-item>
              <mat-list-item>
                <mat-icon matListItemIcon>check_circle_outline</mat-icon>
                <span matListItemTitle>保険料計算</span>
              </mat-list-item>
              <mat-list-item>
                <mat-icon matListItemIcon>check_circle_outline</mat-icon>
                <span matListItemTitle>届出確認</span>
              </mat-list-item>
            </mat-list>
          </mat-card-content>
        </mat-card>
      }

      <mat-card>
        <mat-card-header>
          <mat-icon mat-card-avatar>notifications</mat-icon>
          <mat-card-title>通知</mat-card-title>
        </mat-card-header>
        <mat-card-content>
          <p class="empty-state">未読の通知はありません</p>
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: [`
    .dashboard-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
      gap: 24px;
      margin-top: 16px;
    }
    .empty-state {
      color: rgba(0, 0, 0, 0.54);
      text-align: center;
      padding: 16px 0;
    }
  `],
})
export class DashboardComponent {
  auth = inject(AuthService);
}
