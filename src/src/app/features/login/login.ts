import { Component, inject, signal, OnInit } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../core/services/auth.service';
import { LogoComponent } from '../../shared/ui';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    FormsModule, MatCardModule, MatFormFieldModule,
    MatInputModule, MatButtonModule, MatIconModule,
    MatProgressSpinnerModule, LogoComponent,
  ],
  template: `
    <div class="login-container">
      <mat-card class="login-card">
        <div class="brand">
          <app-logo [size]="36" />
          <p class="tagline">社会保険の手続きと保険料の管理</p>
        </div>
        <h1 class="heading">ログイン</h1>
        <mat-card-content>
          @if (timeoutMessage()) {
            <p class="timeout-msg">セッションがタイムアウトしました。再度ログインしてください。</p>
          }
          <form (ngSubmit)="onLogin()">
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>メールアドレス</mat-label>
              <input matInput type="email" [(ngModel)]="email" name="email" required>
              <mat-icon matPrefix>email</mat-icon>
            </mat-form-field>
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>パスワード</mat-label>
              <input matInput type="password" [(ngModel)]="password" name="password" required>
              <mat-icon matPrefix>lock</mat-icon>
            </mat-form-field>
            @if (error()) {
              <p class="error">{{ error() }}</p>
            }
            <button mat-flat-button color="primary" type="submit"
                    class="full-width login-btn" [disabled]="submitting()">
              @if (submitting()) {
                <mat-spinner diameter="20"></mat-spinner>
              } @else {
                ログイン
              }
            </button>
          </form>
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: [`
    .login-container {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      padding: var(--app-space-4);
      box-sizing: border-box;
      background: var(--app-color-bg);
    }
    .login-card {
      width: 100%;
      max-width: 400px;
      padding: var(--app-space-5);
      box-sizing: border-box;
    }
    .login-card { border: 1px solid var(--app-color-border); box-shadow: var(--app-shadow); border-radius: var(--app-radius); }
    .brand { display: flex; flex-direction: column; gap: var(--app-space-2); }
    .brand app-logo ::ng-deep .word { font-size: 28px; }
    .tagline { margin: 0; font-size: var(--app-font-sm); color: var(--app-color-muted); }
    .heading { margin: var(--app-space-5) 0 0; font-size: var(--app-font-lg); font-weight: 700; }
    /* 浮き上がったラベルが見出しと重ならないよう、フォームとの間を空ける */
    mat-card-content { padding: var(--app-space-5) 0 0; }
    .full-width { width: 100%; }
    .login-btn { height: 48px; margin-top: var(--app-space-2); }
    .error { color: var(--app-status-action-fg); font-size: var(--app-font-md); margin: var(--app-space-2) 0; }
    .timeout-msg { color: var(--app-color-text); font-size: var(--app-font-md); margin: 0 0 var(--app-space-4); padding: var(--app-space-2) var(--app-space-3); background: var(--app-status-action-bg); border-radius: var(--app-radius); }
  `],
})
export class LoginComponent implements OnInit {
  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  email = '';
  password = '';
  error = signal('');
  submitting = signal(false);
  timeoutMessage = signal(false);

  ngOnInit() {
    this.timeoutMessage.set(this.route.snapshot.queryParams['reason'] === 'timeout');
  }

  async onLogin() {
    this.error.set('');
    this.submitting.set(true);
    try {
      await this.auth.login(this.email, this.password);
      this.router.navigate(['/dashboard']);
    } catch {
      this.error.set('メールアドレスまたはパスワードが正しくありません');
    } finally {
      this.submitting.set(false);
    }
  }
}
