import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../core/services/auth.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm-dialog';
import { PageHeadComponent } from '../../shared/ui';

interface SessionItem {
  id: string;
  method: string;
  ip: string;
  userAgent: string;
  createdAt: string;
  lastActiveAt: string;
  current: boolean;
}

/** ブラウザーの名前を短く（端末の一覧で見分けるため） */
function browserName(ua: string): string {
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone・iPad' : 'その他';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'ブラウザー';
  return `${br}（${os}）`;
}

/** 自分のアカウント：パスワードの変更と、ログイン中の端末の一覧・切断（カタログ14章） */
@Component({
  selector: 'app-account',
  standalone: true,
  imports: [DatePipe, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, PageHeadComponent],
  template: `
    <app-page-head heading="自分のアカウント">
      <span meta>{{ auth.profile()?.displayName }}（{{ auth.profile()?.email }}）</span>
    </app-page-head>

    @if (auth.mustChangePassword(); as reason) {
      <p class="must" data-testid="must-change">{{ reason }}</p>
    }

    <section class="card">
      <h2>パスワードを変える</h2>
      <p class="sub">8文字以上で、英字と数字の両方を含めてください。前に使ったパスワードは使えません。Google でログインしている人は変えなくてかまいません。</p>
      <form (ngSubmit)="changePassword()" class="fields">
        <mat-form-field appearance="outline">
          <mat-label>今のパスワード</mat-label>
          <input matInput type="password" name="current" [(ngModel)]="current" autocomplete="current-password">
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>新しいパスワード</mat-label>
          <input matInput type="password" name="next" [(ngModel)]="next" autocomplete="new-password">
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>新しいパスワード（確認）</mat-label>
          <input matInput type="password" name="confirm" [(ngModel)]="confirmNext" autocomplete="new-password">
        </mat-form-field>
        @if (problem(); as p) { <p class="error">{{ p }}</p> }
        <div><button mat-flat-button color="primary" type="submit" [disabled]="busy() || !current || !!problem() || !next">変える</button></div>
      </form>
    </section>

    <section class="card">
      <h2>ログイン中の端末</h2>
      <p class="sub">心当たりのない端末があれば切断し、パスワードを変えてください。ログインから8時間、または30分操作がないと自動でログアウトします。</p>
      @if (sessionsError()) { <p class="error">{{ sessionsError() }}</p> }
      <table class="sessions">
        <thead><tr><th>端末</th><th>IP</th><th>ログイン</th><th>最後の操作</th><th></th></tr></thead>
        <tbody>
          @for (s of sessions(); track s.id) {
            <tr>
              <td>{{ name(s.userAgent) }}@if (s.method === 'google') {・Google}@if (s.current) { <b>（この端末）</b> }</td>
              <td>{{ s.ip }}</td>
              <td>{{ s.createdAt | date: 'M/d H:mm' }}</td>
              <td>{{ s.lastActiveAt | date: 'M/d H:mm' }}</td>
              <td>@if (!s.current) { <button mat-button color="warn" type="button" (click)="revoke(s)">切断する</button> }</td>
            </tr>
          } @empty {
            <tr><td colspan="5">読み込み中…</td></tr>
          }
        </tbody>
      </table>
    </section>
  `,
  styles: [`
    :host { display: block; padding: var(--app-space-5); max-width: 960px; }
    .card { background: var(--app-color-surface); border: 1px solid var(--app-color-border); border-radius: var(--app-radius); padding: var(--app-space-4); margin-bottom: var(--app-space-4); }
    h2 { margin: 0 0 var(--app-space-2); font-size: var(--app-font-lg); }
    .sub { margin: 0 0 var(--app-space-3); color: var(--app-color-text-sub); font-size: var(--app-font-sm); }
    .fields { display: flex; flex-direction: column; max-width: 360px; }
    .error { color: var(--app-status-error-fg); font-size: var(--app-font-sm); margin: 0 0 var(--app-space-2); }
    .must { padding: var(--app-space-2) var(--app-space-3); background: var(--app-status-attention-bg); color: var(--app-status-attention-fg); border-radius: var(--app-radius); font-weight: 600; }
    .sessions { width: 100%; border-collapse: collapse; font-size: var(--app-font-sm); }
    .sessions th, .sessions td { text-align: left; padding: var(--app-space-2); border-bottom: 1px solid var(--app-color-border); }
    .sessions th { color: var(--app-color-text-sub); font-weight: 600; }
  `],
})
export class AccountComponent implements OnInit {
  auth = inject(AuthService);
  private functions = inject(Functions);
  private snackBar = inject(MatSnackBar);
  private confirm = inject(ConfirmService);

  current = '';
  next = '';
  confirmNext = '';
  busy = signal(false);
  sessions = signal<SessionItem[]>([]);
  sessionsError = signal('');
  name = browserName;

  ngOnInit() {
    void this.loadSessions();
  }

  problem(): string | null {
    if (!this.next) return null;
    if (this.next.length < 8) return '8文字以上にしてください';
    if (!/[A-Za-z]/.test(this.next) || !/\d/.test(this.next)) return '英字と数字の両方を含めてください';
    if (this.confirmNext && this.confirmNext !== this.next) return '確認のパスワードが一致しません';
    if (!this.confirmNext) return '確認のためもう一度入れてください';
    return null;
  }

  async changePassword() {
    this.busy.set(true);
    try {
      await httpsCallable(this.functions, 'authChangePassword')({
        companyId: this.auth.companyId, currentPassword: this.current, newPassword: this.next,
      });
      this.current = this.next = this.confirmNext = '';
      this.auth.mustChangePassword.set(null);
      this.snackBar.open('パスワードを変えました', '閉じる', { duration: 3000 });
    } catch (e: any) {
      this.snackBar.open(`変えられませんでした：${e?.message ?? ''}`, '閉じる', { duration: 6000 });
    } finally {
      this.busy.set(false);
    }
  }

  async loadSessions() {
    try {
      const { data } = await httpsCallable<object, { items: SessionItem[] }>(this.functions, 'authSessionList')({ companyId: this.auth.companyId });
      this.sessions.set(data.items);
    } catch (e: any) {
      this.sessionsError.set(`端末の一覧を取得できませんでした：${e?.message ?? ''}`);
    }
  }

  async revoke(s: SessionItem) {
    const ok = await this.confirm.ask({
      title: 'この端末を切断しますか',
      message: `${browserName(s.userAgent)}（IP ${s.ip}）のログインを切ります。その端末ではログインし直しが必要になります。`,
      confirmLabel: '切断する',
      warn: true,
    });
    if (!ok) return;
    try {
      await httpsCallable(this.functions, 'authSessionRevoke')({ companyId: this.auth.companyId, sessionId: s.id });
      await this.loadSessions();
      this.snackBar.open('切断しました', '閉じる', { duration: 3000 });
    } catch (e: any) {
      this.snackBar.open(`切断できませんでした：${e?.message ?? ''}`, '閉じる', { duration: 6000 });
    }
  }
}
