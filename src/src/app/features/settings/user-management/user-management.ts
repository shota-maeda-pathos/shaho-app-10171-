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
import { AccessOffice, UserAccessDialogComponent, UserAccessResult } from './user-access-dialog';

interface UserRow {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  officeIds: string[];
  isSuspended: boolean;
}

interface InvitationRow {
  id: string;
  email: string;
  roles: string[];
  status: string;
  expiresAt: string;
}

const ROLE_LABELS: Record<string, string> = {
  admin: '管理者', approver: '承認者', operator: '操作担当',
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
              <mat-label>メールアドレス</mat-label>
              <input matInput [(ngModel)]="inviteEmail" type="email">
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>ロール</mat-label>
              <mat-select [(ngModel)]="inviteRoles" multiple>
                <mat-option value="admin">管理者</mat-option>
                <mat-option value="approver">承認者</mat-option>
                <mat-option value="operator">操作担当</mat-option>
                <mat-option value="viewer">閲覧者</mat-option>
                <mat-option value="employee">従業員</mat-option>
              </mat-select>
            </mat-form-field>
          </div>
          <div class="form-actions">
            <button mat-stroked-button (click)="showInviteForm.set(false)">キャンセル</button>
            <button mat-flat-button color="primary" (click)="sendInvite()"
              [disabled]="!inviteEmail || inviteRoles.length === 0 || inviting()">
              招待を送信
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
              <th mat-header-cell *matHeaderCellDef>メール</th>
              <td mat-cell *matCellDef="let row">{{ row.email }}</td>
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
                <button mat-button (click)="unlock(row)" [attr.aria-label]="row.displayName + 'のログインのロックを解除'">ロック解除</button>
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
              <th mat-header-cell *matHeaderCellDef>メール</th>
              <td mat-cell *matCellDef="let row">{{ row.email }}</td>
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

  inviteEmail = '';
  inviteRoles: string[] = [];

  userColumns = ['displayName', 'email', 'roles', 'offices', 'status', 'actions'];
  invitationColumns = ['email', 'roles', 'status', 'expiresAt', 'inviteActions'];

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
    } catch (e: any) {
      this.snackBar.open(`解除できませんでした：${e?.message ?? ''}`, '閉じる', { duration: 6000 });
    }
  }
  isOfficeRole = (role: string) => ['operator', 'approver', 'viewer'].includes(role);

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

  async sendInvite() {
    this.inviting.set(true);
    try {
      const fn = httpsCallable(this.functions, 'userInvite');
      await fn({
        companyId: this.auth.companyId,
        email: this.inviteEmail,
        roles: this.inviteRoles,
      });
      this.snackBar.open('招待を送信しました', '閉じる', { duration: 3000 });
      this.inviteEmail = '';
      this.inviteRoles = [];
      this.showInviteForm.set(false);
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
