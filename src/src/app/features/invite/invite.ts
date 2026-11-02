import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../core/services/auth.service';

interface InvitationInfo {
  email: string;
  displayName?: string;
  expiresAt: string;
  googleAllowed: boolean;
}

/** 招待を受けて利用者になる画面（カタログ14章の招待制。招待のないメールアドレスでは登録できない） */
@Component({
  selector: 'app-invite',
  standalone: true,
  imports: [DatePipe, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  template: `
    <div class="wrap">
      <div class="card">
        <h1>招待を受ける</h1>
        @if (info(); as i) {
          <p>{{ i.email }} あての招待です（期限 {{ i.expiresAt | date: 'M月d日 H:mm' }}）。</p>
          <mat-form-field appearance="outline" class="full">
            <mat-label>氏名（画面や記録に表示されます）</mat-label>
            <input matInput name="displayName" [(ngModel)]="displayName">
          </mat-form-field>
          @if (i.googleAllowed) {
            <button mat-stroked-button type="button" class="full" (click)="accept(true)" [disabled]="busy() || !displayName.trim()">Google アカウントで登録する</button>
            <div class="or"><span>または パスワードを決める</span></div>
          }
          <mat-form-field appearance="outline" class="full">
            <mat-label>パスワード（8文字以上・英字と数字）</mat-label>
            <input matInput type="password" name="password" [(ngModel)]="password" autocomplete="new-password">
          </mat-form-field>
          @if (problem(); as p) { <p class="error">{{ p }}</p> }
          <button mat-flat-button color="primary" type="button" class="full" (click)="accept(false)"
                  [disabled]="busy() || !displayName.trim() || !password || !!problem()">パスワードで登録する</button>
        }
        @if (error()) { <p class="error">{{ error() }}</p> }
        @if (!info() && !error()) { <p>読み込み中…</p> }
      </div>
    </div>
  `,
  styles: [`
    .wrap { display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: var(--app-space-4); box-sizing: border-box; background: var(--app-color-surface-sub); }
    .card { width: 100%; max-width: 420px; padding: var(--app-space-5); background: var(--app-color-surface); border: 1px solid var(--app-color-border); border-radius: var(--app-radius); box-sizing: border-box; }
    h1 { margin: 0 0 var(--app-space-3); font-size: var(--app-font-lg); }
    .full { width: 100%; }
    .or { display: flex; align-items: center; gap: var(--app-space-2); margin: var(--app-space-4) 0; color: var(--app-color-text-sub); font-size: var(--app-font-sm); }
    .or::before, .or::after { content: ''; flex: 1; border-top: 1px solid var(--app-color-border); }
    .error { color: var(--app-status-error-fg); font-size: var(--app-font-sm); }
  `],
})
export class InviteComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private functions = inject(Functions);
  private auth = inject(AuthService);

  info = signal<InvitationInfo | null>(null);
  error = signal('');
  busy = signal(false);
  displayName = '';
  password = '';
  private id = '';

  async ngOnInit() {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    try {
      const { data } = await httpsCallable<object, InvitationInfo>(this.functions, 'authInvitationGet')({ companyId: this.auth.companyId, invitationId: this.id });
      this.info.set(data);
      if (data.displayName && !this.displayName) this.displayName = data.displayName;
    } catch (e: any) {
      this.error.set(e?.message ?? '招待を読み込めませんでした');
    }
  }

  problem(): string | null {
    if (!this.password) return null;
    if (this.password.length < 8) return '8文字以上にしてください';
    if (!/[A-Za-z]/.test(this.password) || !/\d/.test(this.password)) return '英字と数字の両方を含めてください';
    return null;
  }

  async accept(google: boolean) {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.acceptInvitation({ invitationId: this.id, displayName: this.displayName.trim(), ...(google ? { google } : { password: this.password }) });
      await this.router.navigate(['/']);
    } catch (e: any) {
      if (e?.code !== 'auth/popup-closed-by-user') this.error.set(e?.message ?? '登録できませんでした');
    } finally {
      this.busy.set(false);
    }
  }
}
