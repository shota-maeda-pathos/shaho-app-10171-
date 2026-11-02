import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../../core/services/auth.service';
import { AccessOffice, USER_ROLES, UserAccessDialogComponent, UserAccessResult } from './user-access-dialog';

interface UserRow {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  officeIds: string[];
  isSuspended: boolean;
  isLocked?: boolean;
}

interface InvitationRow {
  id: string;
  email: string;
  displayName?: string;
  roles: string[];
  officeIds?: string[];
  status: string;
  expiresAt: string;
}

const ROLE_LABELS: Record<string, string> = {
  admin: '管理者', approver: '承認者', operator: '担当者',
  viewer: '閲覧者', employee: '従業員',
};

@Component({
  selector: 'app-user-management',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatTableModule, MatButtonModule, MatIconModule, MatCardModule,
    MatChipsModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    MatDialogModule, MatProgressSpinnerModule, MatSnackBarModule,
  ],
  template: `
    <div class="page-container">
      <div class="page-header">
        <button mat-flat-button color="primary" (click)="showInviteForm.set(!showInviteForm())">
          <mat-icon>person_add</mat-icon>
          ユーザー招待
        </button>
      </div>

      @if (showInviteForm()) {
        <mat-card class="invite-form">
          <h3>新規ユーザー招待</h3>
          <div class="form-row">
            <mat-form-field appearance="outline">
              <mat-label>氏名</mat-label>
              <input matInput [(ngModel)]="inviteName" maxlength="50">
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>メールアドレス</mat-label>
              <input matInput [(ngModel)]="inviteEmail" type="email">
            </mat-form-field>
          </div>
          <div class="form-row">
            <mat-form-field appearance="outline">
              <mat-label>ロール（複数選択可）</mat-label>
              <mat-select [(ngModel)]="inviteRoles" multiple>
                @for (role of staffRoles; track role.value) {
                  <mat-option [value]="role.value">{{ role.label }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>担当事業所（複数選択可）</mat-label>
              <mat-select [(ngModel)]="inviteOfficeIds" multiple [disabled]="inviteRoles.includes('admin')">
                @for (office of offices(); track office.id) {
                  @if (office.isActive) { <mat-option [value]="office.id">{{ office.name }}</mat-option> }
                }
              </mat-select>
            </mat-form-field>
          </div>
          @if (inviteRoles.includes('admin')) {
            <p class="form-note">管理者は全事業所を扱えます（担当事業所は選びません）。</p>
          } @else if (inviteNeedsOffices() && inviteOfficeIds.length === 0) {
            <p class="form-note">担当者・承認者・閲覧者は、選んだ担当事業所のデータだけを扱います。担当事業所を選んでください。</p>
          }
          <p class="form-note">招待はメールでは送りません。作るとリンクをコピーするので、本人に渡してください（期限7日。「招待中」からもう一度コピーできます）。従業員（本人ポータル）は、従業員の画面の「本人ポータル」から招待します。</p>
          <div class="form-actions">
            <button mat-stroked-button (click)="showInviteForm.set(false)">キャンセル</button>
            <button mat-flat-button color="primary" (click)="sendInvite()" [disabled]="!canInvite()">
              招待を作ってリンクをコピー
            </button>
          </div>
        </mat-card>
      }

      <h2>ユーザー一覧</h2>
      <p>ロールは操作できる内容、担当事業所はアクセスできる範囲を表します。管理者は全事業所を管理できます。</p>
      <p>自分自身の権限は変更できません。変更が必要な場合は、別の管理者に依頼してください。</p>
      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
        <button mat-stroked-button (click)="loadUsers()" [disabled]="loading()">再読み込み</button>
      }
      @if (officeError()) {
        <p class="error" role="alert">{{ officeError() }}</p>
        <button mat-stroked-button (click)="loadOffices()" [disabled]="loadingOffices()">事業所を再読み込み</button>
      }
      @if (loading()) {
        <div class="loading-container"><mat-spinner diameter="40"></mat-spinner></div>
      } @else {
        <mat-card>
          <table mat-table [dataSource]="users()" class="full-width-table">
            <ng-container matColumnDef="displayName">
              <th mat-header-cell *matHeaderCellDef>名前</th>
              <td mat-cell *matCellDef="let row">{{ row.displayName }}</td>
            </ng-container>

            <ng-container matColumnDef="email">
              <th mat-header-cell *matHeaderCellDef>氏名・メール</th>
              <td mat-cell *matCellDef="let row">
                @if (row.displayName) { <div>{{ row.displayName }}</div> }
                <div>{{ row.email }}</div>
              </td>
            </ng-container>

            <ng-container matColumnDef="inviteOffices">
              <th mat-header-cell *matHeaderCellDef>担当事業所</th>
              <td mat-cell *matCellDef="let row">
                @if (row.roles.includes('admin')) { 全事業所 }
                @else { @for (id of row.officeIds ?? []; track id) { <div>{{ officeName(id) }}</div> } }
              </td>
            </ng-container>

            <ng-container matColumnDef="roles">
              <th mat-header-cell *matHeaderCellDef>ロール</th>
              <td mat-cell *matCellDef="let row">
                @for (role of row.roles; track role) {
                  <span class="role-chip">{{ roleLabel(role) }}</span>
                }
              </td>
            </ng-container>

            <ng-container matColumnDef="status">
              <th mat-header-cell *matHeaderCellDef>状態</th>
              <td mat-cell *matCellDef="let row">
                <span class="status-chip" [class.suspended]="row.isSuspended">
                  {{ row.isSuspended ? '停止中' : '有効' }}
                </span>
              </td>
            </ng-container>

            <ng-container matColumnDef="offices">
              <th mat-header-cell *matHeaderCellDef>担当事業所</th>
              <td mat-cell *matCellDef="let row">
                @if (row.roles.includes('admin')) {
                  <span>全事業所</span>
                } @else if (coversAllOffices(row.officeIds)) {
                  <span>全事業所</span>
                } @else if (row.officeIds.length > 0) {
                  @for (id of row.officeIds; track id) { <div>{{ officeName(id) }}</div> }
                } @else {
                  <span>{{ row.roles.some(isOfficeRole) ? '未設定' : '担当設定なし（本人向け）' }}</span>
                }
              </td>
            </ng-container>

            <ng-container matColumnDef="actions">
              <th mat-header-cell *matHeaderCellDef>操作</th>
              <td mat-cell *matCellDef="let row">
                @if (isSelf(row)) {
                  <span>自分（変更不可）</span>
                } @else {
                  <button mat-stroked-button (click)="editAccess(row)"
                    [disabled]="!canEdit()" [attr.aria-label]="row.displayName + 'の権限を変更'">
                    権限を変更
                  </button>
                }
                @if (row.isLocked) { <button mat-button (click)="unlock(row)" [attr.aria-label]="row.displayName + 'のログインのロックを解除'">ロック解除</button> }
              </td>
            </ng-container>

            <tr mat-header-row *matHeaderRowDef="userColumns"></tr>
            <tr mat-row *matRowDef="let row; columns: userColumns"></tr>
          </table>

          @if (users().length === 0 && !error()) {
            <div class="empty-state">
              <mat-icon>people</mat-icon>
              <p>ユーザーがいません</p>
            </div>
          }
        </mat-card>
      }

      @if (invitations().length > 0) {
        <h2>招待中</h2>
        <mat-card>
          <table mat-table [dataSource]="invitations()" class="full-width-table">
            <ng-container matColumnDef="email">
              <th mat-header-cell *matHeaderCellDef>氏名・メール</th>
              <td mat-cell *matCellDef="let row">
                @if (row.displayName) { <div>{{ row.displayName }}</div> }
                <div>{{ row.email }}</div>
              </td>
            </ng-container>

            <ng-container matColumnDef="inviteOffices">
              <th mat-header-cell *matHeaderCellDef>担当事業所</th>
              <td mat-cell *matCellDef="let row">
                @if (row.roles.includes('admin')) { 全事業所 }
                @else { @for (id of row.officeIds ?? []; track id) { <div>{{ officeName(id) }}</div> } }
              </td>
            </ng-container>

            <ng-container matColumnDef="roles">
              <th mat-header-cell *matHeaderCellDef>ロール</th>
              <td mat-cell *matCellDef="let row">
                @for (role of row.roles; track role) {
                  <span class="role-chip">{{ roleLabel(role) }}</span>
                }
              </td>
            </ng-container>

            <ng-container matColumnDef="status">
              <th mat-header-cell *matHeaderCellDef>状態</th>
              <td mat-cell *matCellDef="let row">{{ isExpired(row) ? '期限切れ' : row.status === 'pending' ? '招待中' : row.status }}</td>
            </ng-container>

            <ng-container matColumnDef="expiresAt">
              <th mat-header-cell *matHeaderCellDef>有効期限</th>
              <td mat-cell *matCellDef="let row">{{ row.expiresAt | date: 'yyyy/M/d H:mm' }}</td>
            </ng-container>

            <ng-container matColumnDef="inviteActions">
              <th mat-header-cell *matHeaderCellDef>操作</th>
              <td mat-cell *matCellDef="let row">
                @if (isExpired(row)) {
                  <button mat-stroked-button (click)="reissue(row)">再発行</button>
                } @else {
                  <button mat-stroked-button (click)="copyLink(row)">招待のリンクをコピー</button>
                }
              </td>
            </ng-container>

            <tr mat-header-row *matHeaderRowDef="invitationColumns"></tr>
            <tr mat-row *matRowDef="let row; columns: invitationColumns"></tr>
          </table>
        </mat-card>
      }
    </div>
  `,
  styles: [`
    .page-container { padding: 24px 0; }
    .page-header { display: flex; justify-content: flex-end; align-items: center; margin-bottom: 8px; }
    .page-header h1 { margin: 0; font-size: 24px; font-weight: 500; }
    h2 { font-size: 18px; font-weight: 500; margin: 8px 0 12px; }
    .invite-form { padding: 24px; margin-bottom: 24px; }
    .invite-form h3 { margin: 0 0 16px; }
    .form-row { display: flex; gap: 16px; }
    .form-row mat-form-field { flex: 1; }
    .form-note { font-size: 13px; color: var(--app-text-secondary, #5f6368); margin: 0 0 8px; }
    .form-actions { display: flex; justify-content: flex-end; gap: 12px; }
    .full-width-table { width: 100%; }
    .loading-container { display: flex; justify-content: center; padding: 48px; }
    .empty-state { text-align: center; padding: 48px; color: #666; }
    .empty-state mat-icon { font-size: 48px; width: 48px; height: 48px; color: #ccc; }
    .role-chip { display: inline-block; white-space: nowrap; margin-bottom: 2px; padding: 2px 8px; border-radius: 12px; font-size: 11px; background: var(--app-brand-tint); color: var(--app-brand-strong); margin-right: 4px; }
    .status-chip { white-space: nowrap; padding: 4px 12px; border-radius: 16px; font-size: 12px; background: #e8f5e9; color: #2e7d32; }
    .status-chip.suspended { background: #ffebee; color: #c62828; }
    .error { color: #b3261e; }
    mat-card { overflow-x: auto; }
    td.mat-mdc-cell, th.mat-mdc-header-cell { padding: 12px; }
    td.mat-mdc-cell:first-child, th.mat-mdc-header-cell:first-child { padding-left: var(--app-space-5); }
  `],
})
export class UserManagementComponent implements OnInit {
  private functions = inject(Functions);
  private snackBar = inject(MatSnackBar);
  private auth = inject(AuthService);
  private dialog = inject(MatDialog);

  users = signal<UserRow[]>([]);
  invitations = signal<InvitationRow[]>([]);
  loading = signal(false);
  showInviteForm = signal(false);
  inviting = signal(false);
  offices = signal<AccessOffice[]>([]);
  loadingOffices = signal(false);
  officesLoaded = signal(false);
  error = signal('');
  officeError = signal('');

  inviteName = '';
  inviteEmail = '';
  inviteRoles: string[] = [];
  inviteOfficeIds: string[] = [];
  /** この画面で招待するのはスタッフだけ（従業員は従業員の記録につなぐため、従業員の画面から招待する） */
  readonly staffRoles = USER_ROLES.filter(role => role.value !== 'employee');

  userColumns = ['displayName', 'email', 'roles', 'offices', 'status', 'actions'];
  invitationColumns = ['email', 'roles', 'inviteOffices', 'status', 'expiresAt', 'inviteActions'];

  ngOnInit() {
    this.loadUsers();
    this.loadOffices();
  }

  roleLabel(role: string): string { return ROLE_LABELS[role] ?? role; }
  isExpired(row: InvitationRow) { return !!row.expiresAt && new Date(row.expiresAt).getTime() < Date.now(); }

  /** 招待はメールで送らないので、リンクを本人に渡す */
  async copyLink(row: InvitationRow) {
    const url = `${location.origin}/invite/${row.id}`;
    try {
      await navigator.clipboard.writeText(url);
      this.snackBar.open(`${row.email} あての招待のリンクをコピーしました`, '閉じる', { duration: 4000 });
    } catch {
      this.snackBar.open(`招待のリンク：${url}`, '閉じる', { duration: 15000 });
    }
  }

  async reissue(row: InvitationRow) {
    try {
      await httpsCallable(this.functions, 'authInvitationReissue')({ companyId: this.auth.companyId, invitationId: row.id });
      this.snackBar.open(`${row.email} への招待を7日間の期限で出し直しました`, '閉じる', { duration: 4000 });
      await this.loadUsers();
    } catch (e: any) {
      this.snackBar.open(`再発行できませんでした：${e?.message ?? ''}`, '閉じる', { duration: 6000 });
    }
  }

  /** 5回続けて失敗してロックされた人を、30分を待たずに解除する */
  async unlock(user: UserRow) {
    try {
      const { data } = await httpsCallable<object, { wasLocked: boolean }>(this.functions, 'authUnlock')({ companyId: this.auth.companyId, email: user.email });
      this.snackBar.open(data.wasLocked ? `${user.displayName}さんのロックを解除しました` : `${user.displayName}さんはロックされていません`, '閉じる', { duration: 4000 });
      this.users.update(list => list.map(u => u.id === user.id ? { ...u, isLocked: false } : u));
    } catch (e: any) {
      this.snackBar.open(`解除できませんでした：${e?.message ?? ''}`, '閉じる', { duration: 6000 });
    }
  }
  isOfficeRole = (role: string) => ['operator', 'approver', 'viewer'].includes(role);

  /** 今ある事業所をすべて担当している（管理者でない人は、あとで事業所を足すと「全事業所」ではなくなる） */
  coversAllOffices(officeIds: string[]): boolean {
    const offices = this.offices();
    return offices.length > 1 && offices.every(office => officeIds.includes(office.id));
  }

  officeName(id: string): string {
    return this.offices().find(office => office.id === id)?.name
      ?? (this.loadingOffices() ? '事業所を読込中…' : `名称未取得（${id}）`);
  }

  isSelf(user: UserRow) { return user.id === this.auth.profile()?.uid; }
  canEdit() { return this.auth.hasRole('admin') && this.officesLoaded() && !this.loadingOffices(); }

  editAccess(user: UserRow) {
    if (!this.canEdit() || this.isSelf(user)) return;
    this.dialog.open<UserAccessDialogComponent, { user: UserRow; offices: AccessOffice[] }, UserAccessResult>(UserAccessDialogComponent, {
      width: '600px', maxWidth: '95vw', data: { user, offices: this.offices() },
    }).afterClosed().subscribe(result => {
      if (!result) return;
      this.users.update(users => users.map(row => row.id === user.id ? { ...row, ...result } : row));
      this.snackBar.open(`${user.displayName}さんのロール・担当事業所を保存しました`, '閉じる', { duration: 5000 });
    });
  }

  async loadOffices() {
    if (this.loadingOffices()) return;
    this.loadingOffices.set(true);
    this.officesLoaded.set(false);
    this.officeError.set('');
    try {
      const fn = httpsCallable<{ companyId: string; includeInactive: boolean }, { items: AccessOffice[] }>(this.functions, 'officeList');
      const { data } = await fn({ companyId: this.auth.companyId, includeInactive: true });
      this.offices.set(data.items);
      this.officesLoaded.set(true);
    } catch {
      this.officeError.set('担当事業所を取得できませんでした。権限の変更は事業所の再読み込み後に行えます。');
    } finally {
      this.loadingOffices.set(false);
    }
  }

  inviteNeedsOffices() {
    return !this.inviteRoles.includes('admin') && this.inviteRoles.some(role => this.isOfficeRole(role));
  }

  canInvite() {
    return !this.inviting() && !!this.inviteName.trim() && !!this.inviteEmail.trim() && this.inviteRoles.length > 0
      && (!this.inviteNeedsOffices() || this.inviteOfficeIds.length > 0);
  }

  async sendInvite() {
    this.inviting.set(true);
    try {
      const fn = httpsCallable<object, { id: string }>(this.functions, 'userInvite');
      const email = this.inviteEmail.trim();
      const { data } = await fn({
        companyId: this.auth.companyId,
        email,
        displayName: this.inviteName.trim(),
        roles: this.inviteRoles,
        officeIds: this.inviteRoles.includes('admin') ? [] : this.inviteOfficeIds,
      });
      this.inviteName = '';
      this.inviteEmail = '';
      this.inviteRoles = [];
      this.inviteOfficeIds = [];
      this.showInviteForm.set(false);
      await this.copyLink({ id: data.id, email, roles: [], status: 'pending', expiresAt: '' });
      this.loadUsers();
    } catch (e: any) {
      this.snackBar.open(`エラー: ${e.message}`, '閉じる', { duration: 5000 });
    } finally {
      this.inviting.set(false);
    }
  }

  async loadUsers() {
    if (this.loading()) return;
    this.loading.set(true);
    this.error.set('');
    try {
      const fn = httpsCallable<{ companyId: string }, { users: UserRow[]; invitations: InvitationRow[] }>(this.functions, 'userList');
      const result = await fn({ companyId: this.auth.companyId });
      this.users.set(result.data.users ?? []);
      this.invitations.set(result.data.invitations ?? []);
    } catch {
      this.error.set('ユーザー一覧を取得できませんでした。管理者権限と接続状況を確認して、再読み込みしてください。');
    } finally {
      this.loading.set(false);
    }
  }
}
