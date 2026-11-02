import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../../core/services/auth.service';

import { MatDatepickerModule } from '@angular/material/datepicker';
interface Leave {
  id: string;
  leaveTypeLabel: string;
  expectedStartDate: string;
  expectedEndDate: string;
  actualStartDate: string | null;
  actualEndDate: string | null;
  version: number;
  status: string;
  procedureId: string | null;
}
@Component({
  selector: 'app-employee-leaves',
  standalone: true,
  imports: [MatDatepickerModule, FormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <h2>休業管理</h2>
    <p>産休・育休は、申出書・保険料の免除・休業中の変更届や終了届までを手続きの画面で進めます。</p>
    <div class="actions">
      <button mat-flat-button type="button" (click)="startProcedure('maternity')" [disabled]="saving()">産休の手続きを始める</button>
      <button mat-flat-button type="button" (click)="startProcedure('childcare')" [disabled]="saving()">育休の手続きを始める</button>
    </div>
    <h3>介護休業の予定を登録する</h3>
    <form #form="ngForm" (ngSubmit)="register()">
      <div class="fields">
        <mat-form-field appearance="outline"><mat-label>開始予定日</mat-label>
          <input matInput name="start" [(ngModel)]="start" required [matDatepicker]="dp1" placeholder="YYYY/MM/DD"><mat-datepicker-toggle matIconSuffix [for]="dp1" /><mat-datepicker #dp1 />
        </mat-form-field>
        <mat-form-field appearance="outline"><mat-label>終了予定日</mat-label>
          <input matInput name="end" [(ngModel)]="end" [min]="start" required [matDatepicker]="dp2" placeholder="YYYY/MM/DD"><mat-datepicker-toggle matIconSuffix [for]="dp2" /><mat-datepicker #dp2 />
        </mat-form-field>
      </div>
      <p>介護休業は保険料の免除がありません。休業の予定と実績だけを記録します。</p>
      <button mat-flat-button type="submit" [disabled]="form.invalid || saving() || loading() || updating() || !start || end < start">
        {{ saving() ? '登録中...' : '休業予定を登録' }}
      </button>
    </form>
    <h3>休業履歴</h3>
    <p>産休・育休の開始・終了は、それぞれの手続きで記録します（免除の期間も合わせて変わります）。</p>
    @if (error()) {
      <p role="alert">{{ error() }}</p>
      <button mat-stroked-button (click)="load()">再読み込み</button>
    } @else if (loading()) {
      <p>読み込み中...</p>
    } @else {
      @for (leave of leaves(); track leave.id) {
        <div class="record">
          <strong>{{ leave.leaveTypeLabel }}</strong>
          <span>{{ leave.expectedStartDate }} 〜 {{ leave.expectedEndDate }}</span>
          <span>{{ statusLabel(leave.status) }}</span>
          @if (leave.actualStartDate) { <span>実績：{{ leave.actualStartDate }} 〜 {{ leave.actualEndDate ?? '休業中' }}</span> }
          @if (leave.procedureId) {
            <a mat-stroked-button [routerLink]="['/leaves', leave.procedureId]">手続きを開く</a>
          } @else if (leave.status === 'planned' || leave.status === 'scheduled') {
            <button mat-stroked-button (click)="editLeave(leave, 'start')" [disabled]="updating() || saving()">開始を記録</button>
          }
          @if (!leave.procedureId && leave.status === 'active') {
            <button mat-stroked-button (click)="editLeave(leave, 'end')" [disabled]="updating() || saving()">終了を記録</button>
          }
          @if (editing(); as edit) {
            @if (edit.id === leave.id) {
              <form #updateForm="ngForm" (ngSubmit)="updateLeave()">
                <mat-form-field appearance="outline">
                  <mat-label>{{ edit.action === 'start' ? '実際の開始日' : '実際の終了日' }}</mat-label>
                  <input matInput name="actualDate" [(ngModel)]="edit.date" [min]="edit.action === 'end' ? leave.actualStartDate : null" required [matDatepicker]="dp3" placeholder="YYYY/MM/DD"><mat-datepicker-toggle matIconSuffix [for]="dp3" /><mat-datepicker #dp3 />
                </mat-form-field>
                <button mat-flat-button type="submit" [disabled]="updateForm.invalid || updating()">{{ updating() ? '保存中...' : '保存' }}</button>
                <button mat-button type="button" (click)="editing.set(null)" [disabled]="updating()">キャンセル</button>
              </form>
            }
          }
        </div>
      } @empty {
        <p>休業の登録はありません。</p>
      }
      @if (hasMore()) {
        <button mat-stroked-button (click)="load(true)">さらに読み込む</button>
      }
    }
  `,
  styles: [`
    :host { display: block; }
    .fields { display: flex; flex-wrap: wrap; gap: 16px; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .record { display: flex; flex-wrap: wrap; gap: 20px; padding: 16px 0; border-bottom: 1px solid #ddd; }
    h3 { margin-top: 32px; }
  `],
})
export class EmployeeLeavesComponent implements OnInit {
  @Input({ required: true }) employeeId = '';
  private functions = inject(Functions);
  private auth = inject(AuthService);
  private snackBar = inject(MatSnackBar);
  private router = inject(Router);
  leaves = signal<Leave[]>([]);
  updating = signal(false);
  editing = signal<{ id: string; version: number; action: 'start' | 'end'; date: string; requestId: string } | null>(null);
  editLeave(leave: Leave, action: 'start' | 'end') {
    this.editing.set({ id: leave.id, version: leave.version, action, date: '', requestId: crypto.randomUUID() });
  }
  async updateLeave() {
    const edit = this.editing();
    if (!edit || !edit.date || this.updating()) return;
    this.updating.set(true);
    try {
      const fn = httpsCallable<object, { id: string; version: number; status: string; actualStartDate: string; actualEndDate: string | null }>(this.functions, 'leaveUpdate');
      const { data } = await fn({ companyId: this.auth.companyId, employeeId: this.employeeId, leaveId: edit.id, expectedVersion: edit.version, requestId: edit.requestId, action: edit.action, actualDate: edit.date });
      this.leaves.update(rows => rows.map(row => row.id === edit.id ? { ...row, ...data } : row));
      this.editing.set(null);
      this.snackBar.open('休業の実績を保存しました', '閉じる', { duration: 3000 });
    } catch (e: any) {
      this.snackBar.open(e.message ?? '更新できませんでした', '閉じる', { duration: 5000 });
      if (e.code === 'functions/aborted') { this.editing.set(null); await this.load(); }
    } finally { this.updating.set(false); }
  }
  loading = signal(false);
  saving = signal(false);
  error = signal('');
  hasMore = signal(false);
  leaveType = 'nursing';
  start = '';
  end = '';
  ngOnInit() { void this.load(); }
  statusLabel(status: string) {
    return ({ planned: '予定', scheduled: '予定', active: '休業中', ended: '終了', cancelled: '取消' } as Record<string, string>)[status] ?? status;
  }
  async load(append = false) {
    if (this.loading()) return;
    this.loading.set(true);
    this.error.set('');
    try {
      const items = this.leaves();
      const lastDocId = append ? items.at(-1)?.id : undefined;
      const fn = httpsCallable<object, { items: Leave[]; hasMore: boolean }>(this.functions, 'leaveList');
      const { data } = await fn({ companyId: this.auth.companyId, employeeId: this.employeeId, limit: 20, ...(lastDocId ? { lastDocId } : {}) });
      this.leaves.set(append ? [...items, ...data.items] : data.items);
      this.hasMore.set(data.hasMore);
    } catch {
      this.error.set('休業情報を取得できませんでした。接続状況・アクセス権・APIの公開状況を確認してください。');
    } finally { this.loading.set(false); }
  }
  /** 産休・育休の手続きを始める。同じ種類の進行中の手続きがあれば、それを開く */
  async startProcedure(kind: 'maternity' | 'childcare') {
    this.saving.set(true);
    try {
      const { data } = await httpsCallable<object, { procedureId: string }>(this.functions, 'leaveProcedureStart')({ companyId: this.auth.companyId, employeeId: this.employeeId, kind });
      await this.router.navigate(['/leaves', data.procedureId]);
    } catch (e: any) {
      this.snackBar.open(e.message ?? '手続きを始められませんでした', '閉じる', { duration: 6000 });
    } finally { this.saving.set(false); }
  }
  async register() {
    if (this.saving() || this.updating() || this.loading() || !this.start || !this.end || this.end < this.start) return;
    this.saving.set(true);
    try {
      const fn = httpsCallable(this.functions, 'leaveCreate');
      await fn({ companyId: this.auth.companyId, employeeId: this.employeeId, leaveType: this.leaveType, expectedStartDate: this.start, expectedEndDate: this.end });
      this.start = ''; this.end = '';
      this.snackBar.open('休業予定を登録しました', '閉じる', { duration: 3000 });
      await this.load();
    } catch {
      this.snackBar.open('休業予定を登録できませんでした。入力内容と接続状況を確認してください。', '閉じる', { duration: 5000 });
    } finally { this.saving.set(false); }
  }
}
