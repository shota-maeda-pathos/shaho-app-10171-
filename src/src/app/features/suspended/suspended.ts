import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-suspended',
  standalone: true,
  imports: [MatButtonModule, MatIconModule],
  template: `
    <div class="suspended-container">
      <mat-icon class="suspended-icon">lock</mat-icon>
      <h1>アカウントが停止されています</h1>
      <p>このアカウントは管理者により停止されています。</p>
      <p>ポータルへのアクセスが必要な場合は、管理者にお問い合わせください。</p>
      <div class="actions">
        <button mat-flat-button color="primary" (click)="goToPortal()">マイポータル</button>
        <button mat-stroked-button (click)="logout()">ログアウト</button>
      </div>
    </div>
  `,
  styles: [`
    .suspended-container {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      min-height: 80vh; text-align: center; padding: 24px;
    }
    .suspended-icon { font-size: 64px; width: 64px; height: 64px; color: #e65100; margin-bottom: 16px; }
    h1 { font-size: 24px; font-weight: 500; margin: 0 0 8px; }
    p { color: #666; margin: 4px 0; }
    .actions { display: flex; gap: 12px; margin-top: 24px; }
  `],
})
export class SuspendedComponent {
  private auth = inject(AuthService);
  private router = inject(Router);

  goToPortal() { this.router.navigate(['/portal']); }
  async logout() { await this.auth.logout(); this.router.navigate(['/login']); }
}
