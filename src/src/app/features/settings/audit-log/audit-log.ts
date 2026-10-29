import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../../core/services/auth.service';

interface AuditLogRow {
  id: string;
  action: string;
  targetPath: string;
  actorName: string;
  timestamp: string;
  details: Record<string, unknown>;
}

const ACTION_LABELS: Record<string, string> = {
  'employee.create': '従業員作成',
  'employee.update': '従業員更新',
  'employee.delete': '従業員削除',
  'employee.transfer': '異動',
  'employee.resign': '退職',
  'salary.create': '給与作成',
  'salary.update': '給与更新',
  'grade.create': '等級決定',
  'grade.update': '等級変更',
  'filing.create': '届出作成',
  'filing.submit': '届出提出',
  'filing.recordResult': '届出結果記録',
  'approval.create': '承認申請',
  'approval.approve': '承認',
  'approval.reject': '差戻し',
  'user.invite': 'ユーザー招待',
  'user.updateRole': 'ロール変更',
  'dependent.create': '扶養家族追加',
  'dependent.update': '扶養家族更新',
  'dependent.delete': '扶養家族削除',
};

@Component({
  selector: 'app-audit-log',
  standalone: true,
  imports: [
    CommonModule,
    MatTableModule, MatCardModule, MatIconModule,
    MatButtonModule, MatProgressSpinnerModule,
  ],
  template: `
    <div class="section">
      @if (loading()) {
        <div class="loading"><mat-spinner diameter="40"></mat-spinner></div>
      } @else {
        <mat-card>
          <table mat-table [dataSource]="logs()" class="full-width-table">
            <ng-container matColumnDef="timestamp">
              <th mat-header-cell *matHeaderCellDef>日時</th>
              <td mat-cell *matCellDef="let row">{{ formatTimestamp(row.timestamp) }}</td>
            </ng-container>
            <ng-container matColumnDef="action">
              <th mat-header-cell *matHeaderCellDef>操作</th>
              <td mat-cell *matCellDef="let row">
                <span class="action-chip">{{ actionLabel(row.action) }}</span>
              </td>
            </ng-container>
            <ng-container matColumnDef="actorName">
              <th mat-header-cell *matHeaderCellDef>操作者</th>
              <td mat-cell *matCellDef="let row">{{ row.actorName || '(システム)' }}</td>
            </ng-container>
            <ng-container matColumnDef="targetPath">
              <th mat-header-cell *matHeaderCellDef>対象</th>
              <td mat-cell *matCellDef="let row" class="target-cell">{{ shortenPath(row.targetPath) }}</td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="columns"></tr>
            <tr mat-row *matRowDef="let row; columns: columns"></tr>
          </table>

          @if (logs().length === 0) {
            <div class="empty-state">
              <mat-icon>history</mat-icon>
              <p>監査ログがありません</p>
            </div>
          }

          @if (hasMore()) {
            <div class="load-more">
              <button mat-stroked-button (click)="loadMore()">
                さらに読み込む
              </button>
            </div>
          }
        </mat-card>
      }
    </div>
  `,
  styles: [`
    .section { padding: 24px 0; }
    .full-width-table { width: 100%; }
    .loading { display: flex; justify-content: center; padding: 48px; }
    .empty-state { text-align: center; padding: 48px; color: #666; }
    .empty-state mat-icon { font-size: 48px; width: 48px; height: 48px; color: #ccc; }
    .action-chip { padding: 2px 8px; border-radius: 12px; font-size: 11px; background: #f3e5f5; color: #7b1fa2; }
    .target-cell { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: #666; }
    .load-more { text-align: center; margin-top: 16px; padding: 16px; }
  `],
})
export class AuditLogComponent implements OnInit {
  private functions = inject(Functions);
  private auth = inject(AuthService);

  logs = signal<AuditLogRow[]>([]);
  loading = signal(false);
  hasMore = signal(false);
  private lastDocId: string | undefined;

  columns = ['timestamp', 'action', 'actorName', 'targetPath'];

  ngOnInit() {
    this.loadLogs();
  }

  actionLabel(action: string): string {
    return ACTION_LABELS[action] ?? action;
  }

  formatTimestamp(iso: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  shortenPath(path: string): string {
    if (!path) return '';
    const parts = path.split('/');
    if (parts.length >= 4) {
      return `.../${parts.slice(-2).join('/')}`;
    }
    return path;
  }

  loadMore() {
    this.loadLogs();
  }

  private async loadLogs() {
    this.loading.set(true);
    try {
      const fn = httpsCallable<any, any>(this.functions, 'auditLogList');
      const result = await fn({
        companyId: this.auth.companyId,
        limit: 30,
        ...(this.lastDocId ? { lastDocId: this.lastDocId } : {}),
      });
      const items = result.data.items ?? [];
      this.hasMore.set(result.data.hasMore ?? false);
      this.lastDocId = result.data.lastDocId;
      this.logs.update((prev) => [...prev, ...items]);
    } catch {
      // handled by global error handler
    } finally {
      this.loading.set(false);
    }
  }
}
