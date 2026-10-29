import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../../core/services/auth.service';

export interface AccessOffice {
  id: string;
  name: string;
  isActive: boolean;
}

export const USER_ROLES = [
  { value: 'admin', label: '管理者', description: '全事業所の管理とユーザーの権限設定' },
  { value: 'operator', label: '操作担当', description: '担当事業所の登録・計算・申請・承認' },
  { value: 'approver', label: '承認者', description: '担当事業所の申請の確認・承認' },
  { value: 'viewer', label: '閲覧者', description: '担当事業所の閲覧（対応する画面のみ）' },
  { value: 'employee', label: '従業員', description: '本人ポータルの利用' },
];

export interface UserAccessData {
  user: { id: string; displayName: string; email: string; roles: string[]; officeIds: string[] };
  offices: AccessOffice[];
}

export interface UserAccessResult {
  roles: string[];
  officeIds: string[];
}

@Component({
  selector: 'app-user-access-dialog',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatSelectModule],
  template: `
    <h2 mat-dialog-title>ロール・担当事業所の変更</h2>
    <mat-dialog-content>
      <p class="identity"><strong>{{ data.user.displayName }}</strong><br>{{ data.user.email }}</p>
      <form id="user-access-form" (ngSubmit)="save()">
        <mat-form-field appearance="outline">
          <mat-label>ロール（複数選択可）</mat-label>
          <mat-select name="roles" [(ngModel)]="roles" multiple required [disabled]="saving()">
            @for (role of roleOptions; track role.value) {
              <mat-option [value]="role.value">{{ role.label }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <div class="role-help">
          @for (role of roleOptions; track role.value) {
            @if (roles.includes(role.value)) { <p><strong>{{ role.label }}</strong>：{{ role.description }}</p> }
          }
        </div>
        <mat-form-field appearance="outline">
          <mat-label>担当事業所（複数選択可）</mat-label>
          <mat-select name="offices" [(ngModel)]="officeIds" multiple [disabled]="saving()">
            @for (office of officeOptions; track office.id) {
              <mat-option [value]="office.id" [disabled]="!office.isActive && !data.user.officeIds.includes(office.id)">
                {{ office.name }}{{ !office.isActive ? '（無効・未登録）' : '' }}
              </mat-option>
            }
          </mat-select>
        </mat-form-field>
        @if (roles.includes('admin')) {
          <p>管理者は担当事業所の選択にかかわらず、全事業所にアクセスできます。</p>
        } @else if (needsOffices() && officeIds.length === 0) {
          <p class="error" role="alert">担当事業所を選択してください。未設定では対象データを確認できません。</p>
        } @else if (!needsOffices()) {
          <p>従業員ロールだけの場合は、担当事業所を指定しても他の従業員の情報を操作できません。</p>
        }
        <p>担当事業所は業務でアクセスできる範囲です。従業員としての所属事業所は変更されません。</p>
        <p>自分が申請した内容は、自分では承認できません。変更後、対象ユーザーは画面を再読み込みしてください。</p>
        @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="dialog.close()" [disabled]="saving()">キャンセル</button>
      <button mat-flat-button type="submit" form="user-access-form" [disabled]="!canSave()">
        {{ saving() ? '保存中…' : '変更を保存' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    mat-form-field { display: block; width: 100%; }
    .identity { line-height: 1.7; }
    .role-help { margin: -8px 0 20px; }
    p { font-size: 14px; line-height: 1.6; }
    .role-help p { margin: 4px 0; }
    .error { color: #b3261e; }
  `],
})
export class UserAccessDialogComponent {
  readonly data = inject<UserAccessData>(MAT_DIALOG_DATA);
  readonly dialog = inject(MatDialogRef<UserAccessDialogComponent, UserAccessResult>);
  private readonly functions = inject(Functions);
  private readonly auth = inject(AuthService);
  readonly roleOptions = USER_ROLES;
  readonly officeOptions = [
    ...this.data.offices,
    ...this.data.user.officeIds.filter(id => !this.data.offices.some(o => o.id === id))
      .map(id => ({ id, name: `未登録の事業所（${id}）`, isActive: false })),
  ];
  roles = [...this.data.user.roles];
  officeIds = [...this.data.user.officeIds];
  saving = signal(false);
  error = signal('');

  needsOffices() {
    return !this.roles.includes('admin') && this.roles.some(role => ['operator', 'approver', 'viewer'].includes(role));
  }

  canSave() {
    const same = (left: string[], right: string[]) => left.length === right.length && left.every(v => right.includes(v));
    return !this.saving() && this.auth.hasRole('admin') && this.data.user.id !== this.auth.profile()?.uid
      && this.roles.length > 0 && (!this.needsOffices() || this.officeIds.length > 0)
      && (!same(this.roles, this.data.user.roles) || !same(this.officeIds, this.data.user.officeIds));
  }

  async save() {
    if (!this.canSave()) return;
    this.saving.set(true);
    this.error.set('');
    this.dialog.disableClose = true;
    const result = { roles: [...this.roles], officeIds: [...this.officeIds] };
    try {
      await httpsCallable(this.functions, 'userUpdateRole')({
        companyId: this.auth.companyId, userId: this.data.user.id, ...result,
      });
      this.dialog.close(result);
    } catch (error: unknown) {
      this.error.set(error instanceof Error ? error.message : '保存できませんでした。接続状況と管理者権限を確認してください。');
    } finally {
      this.saving.set(false);
      this.dialog.disableClose = false;
    }
  }
}
