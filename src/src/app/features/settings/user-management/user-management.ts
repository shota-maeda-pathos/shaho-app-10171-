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
        <h1>ユーザー管理</h1>
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

            <tr mat-header-row *matHeaderRowDef="userColumns"></tr>
            <tr mat-row *matRowDef="let row; columns: userColumns"></tr>
          </table>

          @if (users().length === 0) {
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
              <td mat-cell *matCellDef="let row">{{ row.status === 'pending' ? '招待中' : row.status }}</td>
            </ng-container>

            <ng-container matColumnDef="expiresAt">
              <th mat-header-cell *matHeaderCellDef>有効期限</th>
              <td mat-cell *matCellDef="let row">{{ row.expiresAt }}</td>
            </ng-container>

            <tr mat-header-row *matHeaderRowDef="invitationColumns"></tr>
            <tr mat-row *matRowDef="let row; columns: invitationColumns"></tr>
          </table>
        </mat-card>
      }
    </div>
  `,
  styles: [`
    .page-container { padding: 24px; }
    .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
    .page-header h1 { margin: 0; font-size: 24px; font-weight: 500; }
    h2 { font-size: 18px; font-weight: 500; margin: 24px 0 12px; }
    .invite-form { padding: 24px; margin-bottom: 24px; }
    .invite-form h3 { margin: 0 0 16px; }
    .form-row { display: flex; gap: 16px; }
    .form-row mat-form-field { flex: 1; }
    .form-actions { display: flex; justify-content: flex-end; gap: 12px; }
    .full-width-table { width: 100%; }
    .loading-container { display: flex; justify-content: center; padding: 48px; }
    .empty-state { text-align: center; padding: 48px; color: #666; }
    .empty-state mat-icon { font-size: 48px; width: 48px; height: 48px; color: #ccc; }
    .role-chip { padding: 2px 8px; border-radius: 12px; font-size: 11px; background: #e3f2fd; color: #1565c0; margin-right: 4px; }
    .status-chip { padding: 4px 12px; border-radius: 16px; font-size: 12px; background: #e8f5e9; color: #2e7d32; }
    .status-chip.suspended { background: #ffebee; color: #c62828; }
  `],
})
export class UserManagementComponent implements OnInit {
  private functions = inject(Functions);
  private snackBar = inject(MatSnackBar);
  private auth = inject(AuthService);

  users = signal<UserRow[]>([]);
  invitations = signal<InvitationRow[]>([]);
  loading = signal(false);
  showInviteForm = signal(false);
  inviting = signal(false);

  inviteEmail = '';
  inviteRoles: string[] = [];

  userColumns = ['displayName', 'email', 'roles', 'status'];
  invitationColumns = ['email', 'roles', 'status', 'expiresAt'];

  ngOnInit() {
    this.loadUsers();
  }

  roleLabel(role: string): string { return ROLE_LABELS[role] ?? role; }

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

  private async loadUsers() {
    this.loading.set(true);
    try {
      const fn = httpsCallable<any, any>(this.functions, 'userList');
      const result = await fn({ companyId: this.auth.companyId });
      this.users.set(result.data.users ?? []);
      this.invitations.set(result.data.invitations ?? []);
    } catch {
      this.users.set([]);
      this.invitations.set([]);
    } finally {
      this.loading.set(false);
    }
  }
}
