import { Component, Input, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../../core/services/auth.service';
import { ConfirmService } from '../../../shared/confirm-dialog/confirm-dialog';

interface SecretsStatus {
  myNumberRegistered: boolean;
  myNumberUpdatedAt: string | null;
  version: number;
}

type Reason = 'filing' | 'identity' | 'inquiry' | 'other';

/** 表示した個人番号を消すまでの秒数 */
const SHOW_SECONDS = 60;

/**
 * 個人番号（カタログ14章）。ふだんは全桁を伏せ、理由を選んだときだけ1回表示する。
 * 番号は関数が Cloud KMS で暗号化して保存し、表示のたびに閲覧ログが残る
 */
@Component({
  selector: 'app-employee-my-number',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <h3>個人番号</h3>
    @if (!canUse) {
      <p class="sub">個人番号は管理者と労務担当者だけが扱えます。</p>
    } @else if (status(); as s) {
      <div class="row">
        <span class="value" data-testid="my-number-value">
          @if (shown()) { {{ format(shown()!) }} } @else if (s.myNumberRegistered) { ●●●● ●●●● ●●●● } @else { 未登録 }
        </span>
        @if (shown()) {
          <button mat-stroked-button type="button" (click)="hide()">隠す</button>
          <span class="sub">{{ remaining() }}秒後に隠します</span>
        } @else if (mode() === 'none') {
          @if (s.myNumberRegistered) {
            <button mat-stroked-button type="button" (click)="mode.set('reveal')">表示する</button>
          }
          <button mat-stroked-button type="button" (click)="mode.set('edit')">{{ s.myNumberRegistered ? '変更する' : '登録する' }}</button>
          @if (s.myNumberRegistered) {
            <button mat-button type="button" color="warn" (click)="remove()" [disabled]="busy()">削除する</button>
          }
        }
      </div>

      @if (mode() === 'reveal') {
        <div class="panel">
          <p>表示する理由を選んでください。理由・日時・操作した人は閲覧ログに残ります。</p>
          <div class="fields">
            <mat-form-field appearance="outline">
              <mat-label>理由</mat-label>
              <mat-select [(ngModel)]="reason" name="reason">
                <mat-option value="filing">届出の作成のため</mat-option>
                <mat-option value="identity">本人確認のため</mat-option>
                <mat-option value="inquiry">本人からの問い合わせのため</mat-option>
                <mat-option value="other">その他</mat-option>
              </mat-select>
            </mat-form-field>
            @if (reason === 'other') {
              <mat-form-field appearance="outline" class="note">
                <mat-label>理由（具体的に）</mat-label>
                <input matInput [(ngModel)]="note" name="note" maxlength="200">
              </mat-form-field>
            }
          </div>
          <div class="actions">
            <button mat-flat-button color="primary" type="button" (click)="reveal()"
                    [disabled]="busy() || !reason || (reason === 'other' && !note.trim())">表示する</button>
            <button mat-button type="button" (click)="cancel()">やめる</button>
          </div>
        </div>
      }

      @if (mode() === 'edit') {
        <div class="panel">
          <div class="fields">
            <mat-form-field appearance="outline">
              <mat-label>個人番号（12桁）</mat-label>
              <input matInput [(ngModel)]="input" name="myNumberInput" inputmode="numeric" maxlength="14"
                     autocomplete="off" placeholder="123456789012">
            </mat-form-field>
          </div>
          @if (input && !valid()) { <p class="error">12桁の数字で入力してください。</p> }
          <div class="actions">
            <button mat-flat-button color="primary" type="button" (click)="save()" [disabled]="busy() || !valid()">保存する</button>
            <button mat-button type="button" (click)="cancel()">やめる</button>
          </div>
        </div>
      }
    } @else if (error()) {
      <p class="error">{{ error() }}</p>
    } @else {
      <p class="sub">読み込み中…</p>
    }
  `,
  styles: [`
    :host { display: block; margin-bottom: var(--app-space-4); }
    h3 { margin: var(--app-space-4) 0 var(--app-space-2); }
    .row { display: flex; gap: var(--app-space-2); align-items: center; flex-wrap: wrap; }
    .value { font-family: monospace; font-size: var(--app-font-lg); min-width: 12em; letter-spacing: .05em; }
    .sub { color: var(--app-color-text-sub); font-size: var(--app-font-sm); }
    .panel { margin-top: var(--app-space-3); padding: var(--app-space-3); background: var(--app-color-surface-sub); border-radius: var(--app-radius); }
    .panel p { margin: 0 0 var(--app-space-2); }
    .fields { display: flex; gap: var(--app-space-2); flex-wrap: wrap; }
    .note { flex: 1; min-width: 240px; }
    .actions { display: flex; gap: var(--app-space-2); }
    .error { color: var(--app-status-error-fg); font-size: var(--app-font-sm); }
  `],
})
export class EmployeeMyNumberComponent implements OnInit, OnDestroy {
  @Input({ required: true }) employeeId!: string;

  private functions = inject(Functions);
  private auth = inject(AuthService);
  private snackBar = inject(MatSnackBar);
  private confirm = inject(ConfirmService);

  canUse = this.auth.hasAnyRole('admin', 'operator');
  status = signal<SecretsStatus | null>(null);
  error = signal('');
  mode = signal<'none' | 'reveal' | 'edit'>('none');
  busy = signal(false);
  shown = signal<string | null>(null);
  remaining = signal(0);
  reason: Reason | '' = '';
  note = '';
  input = '';
  private timer: ReturnType<typeof setInterval> | null = null;

  ngOnInit() {
    if (this.canUse) void this.load();
  }

  ngOnDestroy() {
    this.hide();
  }

  format(n: string): string {
    return `${n.slice(0, 4)} ${n.slice(4, 8)} ${n.slice(8)}`;
  }

  valid(): boolean {
    return /^\d{12}$/.test(this.input.replace(/[\s-]/g, ''));
  }

  async load() {
    try {
      const fn = httpsCallable<object, SecretsStatus>(this.functions, 'employeeSecretsGet');
      const { data } = await fn({ companyId: this.auth.companyId, employeeId: this.employeeId });
      this.status.set(data);
    } catch (e: any) {
      this.error.set(`個人番号の状態を取得できませんでした：${e?.message ?? ''}`);
    }
  }

  cancel() {
    this.mode.set('none');
    this.reason = '';
    this.note = '';
    this.input = '';
  }

  hide() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.shown.set(null);
  }

  async reveal() {
    if (!this.reason) return;
    this.busy.set(true);
    try {
      const fn = httpsCallable<object, { myNumber: string }>(this.functions, 'employeeSecretsReveal');
      const { data } = await fn({
        companyId: this.auth.companyId,
        employeeId: this.employeeId,
        reason: this.reason,
        ...(this.reason === 'other' ? { note: this.note.trim() } : {}),
      });
      this.cancel();
      this.shown.set(data.myNumber);
      // 裏のタブでは時計が間引かれるので、残りは期限の時刻から数える
      const hideAt = Date.now() + SHOW_SECONDS * 1000;
      this.remaining.set(SHOW_SECONDS);
      this.timer = setInterval(() => {
        this.remaining.set(Math.max(0, Math.ceil((hideAt - Date.now()) / 1000)));
        if (this.remaining() <= 0) this.hide();
      }, 1000);
    } catch (e: any) {
      this.snackBar.open(`表示できませんでした：${e?.message ?? ''}`, '閉じる', { duration: 6000 });
    } finally {
      this.busy.set(false);
    }
  }

  async save() {
    await this.write(this.input.replace(/[\s-]/g, ''), '個人番号を保存しました');
  }

  async remove() {
    const ok = await this.confirm.ask({
      title: '個人番号を削除しますか',
      message: '登録した個人番号を消します。消したことは監査ログに残ります。',
      confirmLabel: '削除する',
      warn: true,
    });
    if (ok) await this.write(null, '個人番号を削除しました');
  }

  private async write(myNumber: string | null, done: string) {
    const s = this.status();
    if (!s) return;
    this.busy.set(true);
    try {
      const fn = httpsCallable<object, unknown>(this.functions, 'employeeSecretsUpdate');
      await fn({ companyId: this.auth.companyId, employeeId: this.employeeId, myNumber, expectedVersion: s.version });
      this.cancel();
      this.hide();
      await this.load();
      this.snackBar.open(done, '閉じる', { duration: 3000 });
    } catch (e: any) {
      this.snackBar.open(`保存できませんでした：${e?.message ?? ''}`, '閉じる', { duration: 6000 });
    } finally {
      this.busy.set(false);
    }
  }
}
