import { Component, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatTabsModule } from '@angular/material/tabs';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../../core/services/auth.service';
import { OfficeContextService } from '../../../core/services/office-context.service';

interface ApprovalRow {
  id: string;
  employeeId: string;
  employeeName: string;
  requestType: string;
  status: string;
  requestedBy: string;
  requestedAt: string;
  targetVersion: number;
  summary?: { yearMonth: string | null; totalAmount: number | null; cumulativeBonusAmount: number | null; totalEmployee: number | null; totalEmployer: number | null } | null;
}

const REQUEST_TYPE_LABELS: Record<string, string> = {
  salary: '給与', bonus: '賞与', monthlyInsurance: '月次保険料', bonusInsurance: '賞与保険料',
  filing: '届出', employment: '雇用条件', grade: '等級',
};

const STATUS_LABELS: Record<string, string> = {
  pending: '承認待ち', approved: '承認済み', rejected: '却下', cancelled: '取消',
};

@Component({
  selector: 'app-approval-list',
  standalone: true,
  imports: [
    CommonModule,
    MatTableModule, MatButtonModule, MatIconModule, MatCardModule,
    MatChipsModule, MatTabsModule, MatProgressSpinnerModule,
    MatSnackBarModule, MatDialogModule, RouterLink,
  ],
  template: `
    <div class="page-container">
      <h1>承認管理</h1>
      <p class="hint">毎月の給与・保険料は、<a routerLink="/monthly">毎月の処理</a>の画面で内容を確かめて、まとめて承認できます。</p>
      @if (error()) {
        <p role="alert">{{ error() }}</p>
        <button mat-stroked-button (click)="loadApprovals()" [disabled]="loading()">再読み込み</button>
      }

      <mat-tab-group (selectedIndexChange)="onTabChange($event)">
        <mat-tab label="承認待ち ({{ pendingCount() }})">
          <ng-template matTabContent>
            @if (loading()) {
              <div class="loading-container"><mat-spinner diameter="40"></mat-spinner></div>
            } @else {
              <mat-card>
                <table mat-table [dataSource]="pendingRequests()" class="full-width-table">
                  <ng-container matColumnDef="requestType">
                    <th mat-header-cell *matHeaderCellDef>種別</th>
                    <td mat-cell *matCellDef="let row">{{ requestTypeLabel(row.requestType) }}</td>
                  </ng-container>

                  <ng-container matColumnDef="employeeName">
                    <th mat-header-cell *matHeaderCellDef>対象従業員</th>
                    <td mat-cell *matCellDef="let row">{{ row.employeeName }}
                      @if (row.summary; as summary) {
                        @if (row.requestType === 'salary') { <div>{{ summary.yearMonth }}支給 ／ {{ summary.totalAmount === 0 ? '無給' : '支給額：' + (summary.totalAmount | number) + ' 円' }}</div> }
                        @else if (row.requestType === 'monthlyInsurance') { <div>{{ summary.yearMonth }}分 ／ 本人負担：{{ summary.totalEmployee | number }} 円 ／ 会社負担：{{ summary.totalEmployer | number }} 円</div> }
                        @else { <div>{{ summary.yearMonth }} ／ 賞与額：{{ summary.totalAmount | number }} 円</div> }
                        @if (row.requestType === 'bonus') { <div>年度標準賞与累計：{{ summary.cumulativeBonusAmount | number }} 円</div> }
                        @if (row.requestType === 'bonusInsurance') { <div>本人負担：{{ summary.totalEmployee | number }} 円 ／ 会社負担：{{ summary.totalEmployer | number }} 円</div> }
                      }
                    </td>
                  </ng-container>

                  <ng-container matColumnDef="requestedAt">
                    <th mat-header-cell *matHeaderCellDef>申請日時</th>
                    <td mat-cell *matCellDef="let row">{{ row.requestedAt }}</td>
                  </ng-container>

                  <ng-container matColumnDef="actions">
                    <th mat-header-cell *matHeaderCellDef>操作</th>
                    <td mat-cell *matCellDef="let row">
                      @if (isOwnRequest(row)) {
                        <span class="own-request-label">自分の申請</span>
                      } @else {
                        <button mat-flat-button color="primary" (click)="approve(row)" class="action-btn">
                          <mat-icon>check</mat-icon>承認
                        </button>
                        <button mat-stroked-button color="warn" (click)="reject(row)" class="action-btn">
                          <mat-icon>close</mat-icon>却下
                        </button>
                      }
                    </td>
                  </ng-container>

                  <tr mat-header-row *matHeaderRowDef="pendingColumns"></tr>
                  <tr mat-row *matRowDef="let row; columns: pendingColumns"></tr>
                </table>

                @if (pendingRequests().length === 0 && !error()) {
                  <div class="empty-state">
                    <mat-icon>check_circle</mat-icon>
                    <p>承認待ちの申請はありません</p>
                  </div>
                }
              </mat-card>
            }
          </ng-template>
        </mat-tab>

        <mat-tab label="処理済み">
          <ng-template matTabContent>
            <mat-card>
              <table mat-table [dataSource]="processedRequests()" class="full-width-table">
                <ng-container matColumnDef="requestType">
                  <th mat-header-cell *matHeaderCellDef>種別</th>
                  <td mat-cell *matCellDef="let row">{{ requestTypeLabel(row.requestType) }}</td>
                </ng-container>

                <ng-container matColumnDef="employeeName">
                  <th mat-header-cell *matHeaderCellDef>対象従業員</th>
                  <td mat-cell *matCellDef="let row">{{ row.employeeName }}</td>
                </ng-container>

                <ng-container matColumnDef="status">
                  <th mat-header-cell *matHeaderCellDef>状態</th>
                  <td mat-cell *matCellDef="let row">
                    <span class="status-chip" [attr.data-status]="row.status">
                      {{ statusLabel(row.status) }}
                    </span>
                  </td>
                </ng-container>

                <ng-container matColumnDef="requestedAt">
                  <th mat-header-cell *matHeaderCellDef>申請日時</th>
                  <td mat-cell *matCellDef="let row">{{ row.requestedAt }}</td>
                </ng-container>

                <tr mat-header-row *matHeaderRowDef="processedColumns"></tr>
                <tr mat-row *matRowDef="let row; columns: processedColumns"></tr>
              </table>

              @if (processedRequests().length === 0 && !error()) {
                <div class="empty-state">
                  <mat-icon>history</mat-icon>
                  <p>処理済みの申請はありません</p>
                </div>
              }
            </mat-card>
          </ng-template>
        </mat-tab>
      </mat-tab-group>
    </div>
  `,
  styles: [`
    .page-container { padding: 24px; }
    h1 { margin: 0 0 8px; font-size: 24px; font-weight: 500; }
    .hint { margin: 0 0 16px; color: var(--app-color-text-sub); }
    .hint a { color: var(--app-color-link); }
    .full-width-table { width: 100%; }
    .loading-container { display: flex; justify-content: center; padding: 48px; }
    .empty-state { text-align: center; padding: 48px; color: #666; }
    .empty-state mat-icon { font-size: 48px; width: 48px; height: 48px; color: #ccc; }
    .action-btn { margin-right: 8px; }
    .status-chip { padding: 4px 12px; border-radius: 16px; font-size: 12px; background: #f5f5f5; }
    .status-chip[data-status="approved"] { background: #e8f5e9; color: #2e7d32; }
    .status-chip[data-status="rejected"] { background: #ffebee; color: #c62828; }
    .status-chip[data-status="cancelled"] { background: #f5f5f5; color: #757575; }
    mat-card { margin-top: 16px; }
    .own-request-label { font-size: 12px; color: #888; font-style: italic; }
  `],
})
export class ApprovalListComponent {
  office = inject(OfficeContextService);
  private functions = inject(Functions);
  private snackBar = inject(MatSnackBar);
  private auth = inject(AuthService);

  approvals = signal<ApprovalRow[]>([]);
  loading = signal(false);

  pendingColumns = ['requestType', 'employeeName', 'requestedAt', 'actions'];
  processedColumns = ['requestType', 'employeeName', 'status', 'requestedAt'];

  constructor() {
    // 上部の事業所を選んだ・切り替えたら読み込み直す（承認待ちの見落としを防ぐ）
    effect(() => {
      this.office.selected();
      untracked(() => void this.loadApprovals());
    });
  }

  pendingRequests() {
    return this.approvals().filter((a) => a.status === 'pending');
  }

  processedRequests() {
    return this.approvals().filter((a) => a.status !== 'pending');
  }

  pendingCount() {
    return this.pendingRequests().length;
  }

  onTabChange(_index: number) {}

  requestTypeLabel(type: string): string { return REQUEST_TYPE_LABELS[type] ?? type; }
  statusLabel(status: string): string { return STATUS_LABELS[status] ?? status; }

  isOwnRequest(row: ApprovalRow): boolean {
    return row.requestedBy === this.auth.profile()?.uid;
  }

  async approve(row: ApprovalRow) {
    try {
      const fn = httpsCallable(this.functions, 'approvalRequestApprove');
      await fn({
        companyId: this.auth.companyId,
        employeeId: row.employeeId,
        requestId: row.id,
      });
      this.snackBar.open('承認しました', '閉じる', { duration: 3000 });
      this.loadApprovals();
    } catch (e: any) {
      this.snackBar.open(`エラー: ${e.message}`, '閉じる', { duration: 5000 });
    }
  }

  async reject(row: ApprovalRow) {
    const comment = prompt('却下理由を入力してください');
    if (!comment) return;

    try {
      const fn = httpsCallable(this.functions, 'approvalRequestReject');
      await fn({
        companyId: this.auth.companyId,
        employeeId: row.employeeId,
        requestId: row.id,
        comment,
      });
      this.snackBar.open('却下しました', '閉じる', { duration: 3000 });
      this.loadApprovals();
    } catch (e: any) {
      this.snackBar.open(`エラー: ${e.message}`, '閉じる', { duration: 5000 });
    }
  }

  error = signal('');
  async loadApprovals() {
    this.loading.set(true);
    this.error.set('');
    try {
      const fn = httpsCallable<any, any>(this.functions, 'approvalRequestList');
      const result = await fn({ companyId: this.auth.companyId, ...this.office.params() });
      this.approvals.set(result.data.items ?? []);
    } catch {
      this.error.set('承認情報を取得できませんでした。再読み込みしてください。');
    } finally {
      this.loading.set(false);
    }
  }
}
