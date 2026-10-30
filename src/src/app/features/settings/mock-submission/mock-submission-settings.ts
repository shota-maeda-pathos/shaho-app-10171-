import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../../core/services/auth.service';
import { errorMessage } from '../../onboarding/onboarding.types';

interface MockSettings { auto: boolean; receiveSeconds: number; processSeconds: number; completeSeconds: number }

/** 模擬電子申請の待ち時間（送信済み→受付済み→処理中→完了）。変えられるのは管理者だけ */
@Component({
  selector: 'app-mock-submission-settings',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatInputModule],
  template: `
    <section class="box">
      <h2>模擬電子申請の進み方</h2>
      <p class="sub">模擬電子申請は、送信済み → 受付済み → 処理中 → 完了 の順に進みます。自動で進めるときの待ち時間を決めます。
        自動で進めない場合は、管理者が届出の画面の「次の状態へ進める」で進めます。</p>
      @if (form(); as f) {
        <mat-checkbox [(ngModel)]="f.auto" [disabled]="!isAdmin">自動で進める</mat-checkbox>
        <div class="fields">
          <mat-form-field appearance="outline"><mat-label>送信から受付まで（秒）</mat-label>
            <input matInput type="number" min="0" max="3600" [(ngModel)]="f.receiveSeconds" [disabled]="!isAdmin || !f.auto"></mat-form-field>
          <mat-form-field appearance="outline"><mat-label>受付から処理中まで（秒）</mat-label>
            <input matInput type="number" min="0" max="3600" [(ngModel)]="f.processSeconds" [disabled]="!isAdmin || !f.auto"></mat-form-field>
          <mat-form-field appearance="outline"><mat-label>処理中から完了まで（秒）</mat-label>
            <input matInput type="number" min="0" max="3600" [(ngModel)]="f.completeSeconds" [disabled]="!isAdmin || !f.auto"></mat-form-field>
        </div>
        <p class="sub">画面を開いていないときは、1分ごとの処理で進みます（待ち時間より少し遅れることがあります）。</p>
        @if (isAdmin) {
          <button mat-flat-button type="button" (click)="save()" [disabled]="busy()">保存する</button>
        } @else {
          <p class="sub">変えられるのは管理者だけです。</p>
        }
      } @else {
        <p class="sub" role="status">{{ error() || '読み込んでいます…' }}</p>
      }
    </section>
  `,
  styles: [`
    .box { padding: var(--app-space-5) 0; max-width: 760px; }
    h2 { font-size: 18px; font-weight: 500; margin: 0 0 var(--app-space-2); }
    .sub { color: var(--app-color-text-sub); }
    .fields { display: flex; flex-wrap: wrap; gap: 0 var(--app-space-3); margin-top: var(--app-space-3); }
    .fields mat-form-field { width: 220px; }
  `],
})
export class MockSubmissionSettingsComponent implements OnInit {
  private functions = inject(Functions);
  private auth = inject(AuthService);
  private snackBar = inject(MatSnackBar);

  form = signal<MockSettings | null>(null);
  busy = signal(false);
  error = signal('');
  isAdmin = this.auth.hasRole('admin');

  async ngOnInit() {
    try {
      const { data } = await httpsCallable<object, MockSettings>(this.functions, 'filingMockSettings')({ companyId: this.auth.companyId });
      this.form.set({ ...data });
    } catch (e) {
      this.error.set(errorMessage(e, '設定を読み込めませんでした'));
    }
  }

  async save() {
    const f = this.form();
    if (!f) return;
    const n = (v: unknown) => Math.max(0, Math.min(3600, Math.round(Number(v) || 0)));
    this.busy.set(true);
    try {
      const { data } = await httpsCallable<object, MockSettings>(this.functions, 'filingMockSettings')({
        companyId: this.auth.companyId,
        update: { auto: f.auto, receiveSeconds: n(f.receiveSeconds), processSeconds: n(f.processSeconds), completeSeconds: n(f.completeSeconds) },
      });
      this.form.set({ ...data });
      this.snackBar.open('保存しました。これから送信する届出に使います', '閉じる', { duration: 4000 });
    } catch (e) {
      this.snackBar.open(errorMessage(e, '保存できませんでした'), '閉じる', { duration: 8000 });
    } finally {
      this.busy.set(false);
    }
  }
}
