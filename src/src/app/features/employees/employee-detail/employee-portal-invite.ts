import { Component, OnChanges, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Clipboard } from '@angular/cdk/clipboard';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../../core/services/auth.service';
import { errorMessage } from '../../onboarding/onboarding.types';

type PortalStatus =
  | { state: 'active'; email: string | null; access: 'full' | 'readonly' | 'disabled'; readonlyFrom: string | null; loginStopsFrom: string | null }
  | { state: 'invited'; invitationId: string; email: string; expiresAt: string }
  | { state: 'none'; email: string | null; canInvite: boolean };

/**
 * 本人ポータルの招待。従業員の詳細と入社手続きの完了で使う。
 * 招待はメールで送らないので、作ったリンクをコピーして本人に渡す（ユーザー管理の招待と同じ渡し方）
 */
@Component({
  selector: 'app-employee-portal-invite',
  standalone: true,
  imports: [DatePipe, FormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule],
  template: `
    <section class="portal" aria-label="本人ポータル">
      <h3>本人ポータル</h3>
      @if (status(); as s) {
        @switch (s.state) {
          @case ('active') {
            @switch (s.access) {
              @case ('full') {
                <p class="now"><mat-icon aria-hidden="true" class="ok">check_circle</mat-icon>本人ポータルを使えます{{ s.email ? '（' + s.email + '）' : '' }}。</p>
                @if (s.readonlyFrom) { <p class="sub">退職のため、{{ s.readonlyFrom }} から閲覧のみになります{{ s.loginStopsFrom ? '（' + s.loginStopsFrom + ' からログインできなくなります）' : '' }}。</p> }
              }
              @case ('readonly') {
                <p class="now"><mat-icon aria-hidden="true">visibility</mat-icon>退職のため閲覧のみです{{ s.loginStopsFrom ? '（' + s.loginStopsFrom + ' からログインできなくなります）' : '' }}。申請は出せません。</p>
              }
              @case ('disabled') {
                <p class="now"><mat-icon aria-hidden="true">block</mat-icon>ログインは止まっています{{ s.email ? '（' + s.email + '）' : '' }}。</p>
              }
            }
          }
          @case ('invited') {
            <p class="now">{{ s.email }} に招待しています（{{ s.expiresAt | date:'M月d日 H:mm' }} まで有効）。まだ受け取られていません。</p>
            <div class="actions">
              <button mat-stroked-button type="button" (click)="copy(s.invitationId)"><mat-icon>content_copy</mat-icon>招待のリンクをコピー</button>
              @if (!changing()) { <button mat-button type="button" (click)="startChange(s.email)">メールを変えて招待し直す</button> }
            </div>
            @if (changing()) {
              <p class="sub">今の招待のリンクは使えなくなります。新しいリンクを本人に渡してください。</p>
              <div class="fields">
                <mat-form-field appearance="outline" class="wide"><mat-label>本人のメールアドレス</mat-label>
                  <input matInput type="email" [(ngModel)]="email" name="portalEmailChange" autocomplete="off"></mat-form-field>
                <button mat-flat-button type="button" (click)="invite(true)" [disabled]="busy() || !email.trim()">招待し直す</button>
                <button mat-button type="button" (click)="changing.set(false)">やめる</button>
              </div>
            }
          }
          @case ('none') {
            @if (s.canInvite) {
              <p class="sub">招待すると、本人がログインして自分の情報・保険料の明細を見たり、住所の変更や扶養・休業の申請を出したりできます。</p>
              <div class="fields">
                <mat-form-field appearance="outline" class="wide"><mat-label>本人のメールアドレス</mat-label>
                  <input matInput type="email" [(ngModel)]="email" name="portalEmail" autocomplete="off"></mat-form-field>
                <button mat-flat-button type="button" (click)="invite()" [disabled]="busy() || !email.trim()"><mat-icon>person_add</mat-icon>ポータルに招待</button>
              </div>
            } @else {
              <p class="sub">退職した従業員は本人ポータルに招待できません。</p>
            }
          }
        }
      } @else {
        <p class="sub" role="status">{{ error() || '読み込んでいます…' }}</p>
      }
    </section>
  `,
  styles: [`
    .portal { margin: 8px 0 16px; }
    h3 { margin: 0 0 4px; font-size: 16px; }
    .now { display: flex; align-items: center; gap: 6px; margin: 4px 0 8px; }
    .now mat-icon { color: var(--app-color-text-sub); }
    .now mat-icon.ok { color: var(--app-status-done-fg); }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .sub { color: var(--app-color-text-sub); font-size: 13px; }
    .fields { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 0 12px; margin-top: 8px; }
    .fields .wide { width: min(100%, 360px); }
    .fields button { margin-top: 8px; }
  `],
})
export class EmployeePortalInviteComponent implements OnChanges {
  private functions = inject(Functions);
  private auth = inject(AuthService);
  private snackBar = inject(MatSnackBar);
  private clipboard = inject(Clipboard);

  employeeId = input.required<string>();
  status = signal<PortalStatus | null>(null);
  error = signal('');
  busy = signal(false);
  changing = signal(false);
  email = '';

  ngOnChanges() { void this.load(); }

  async load() {
    try {
      const { data } = await httpsCallable<object, PortalStatus>(this.functions, 'employeePortalStatus')({ companyId: this.auth.companyId, employeeId: this.employeeId() });
      this.status.set(data);
      if (data.state === 'none') this.email = data.email ?? '';
      this.error.set('');
    } catch (e) {
      this.error.set(errorMessage(e, '本人ポータルの状態を読み込めませんでした'));
    }
  }

  startChange(email: string) {
    this.email = email;
    this.changing.set(true);
  }

  /** replace：受け取られていない招待を無効にして作り直す（メールの直し） */
  async invite(replace = false) {
    this.busy.set(true);
    try {
      const { data } = await httpsCallable<object, { id: string }>(this.functions, 'employeePortalInvite')({
        companyId: this.auth.companyId, employeeId: this.employeeId(), email: this.email.trim(), replace,
      });
      this.changing.set(false);
      this.clipboard.copy(this.link(data.id));
      this.snackBar.open('招待を作り、リンクをコピーしました。本人にメールやチャットで送ってください', '閉じる', { duration: 5000 });
      await this.load();
    } catch (e) {
      this.snackBar.open(errorMessage(e, '招待を作れませんでした'), '閉じる', { duration: 5000 });
    } finally {
      this.busy.set(false);
    }
  }

  copy(invitationId: string) {
    this.clipboard.copy(this.link(invitationId));
    this.snackBar.open('招待のリンクをコピーしました。本人にメールやチャットで送ってください', '閉じる', { duration: 4000 });
  }

  private link(invitationId: string) {
    return `${location.origin}/invite/${invitationId}`;
  }
}
