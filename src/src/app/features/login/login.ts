import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    FormsModule, MatCardModule, MatFormFieldModule,
    MatInputModule, MatButtonModule, MatIconModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <div class="login-container">
      <mat-card class="login-card">
        <mat-card-header>
          <mat-card-title>社会保険管理システム</mat-card-title>
          <mat-card-subtitle>ログイン</mat-card-subtitle>
        </mat-card-header>
        <mat-card-content>
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
      height: 100vh;
      background: #f5f5f5;
    }
    .login-card {
      width: 400px;
      padding: 24px;
    }
    .full-width { width: 100%; }
    .login-btn { height: 48px; margin-top: 8px; }
    .error { color: #d32f2f; font-size: 14px; margin: 8px 0; }
  `],
})
export class LoginComponent {
  private auth = inject(AuthService);
  private router = inject(Router);

  email = '';
  password = '';
  error = signal('');
  submitting = signal(false);

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
