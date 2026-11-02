import { Component, inject, signal, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../../core/services/auth.service';

import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatCardModule } from '@angular/material/card';
interface AuditLogRow {
  id: string;
  seq: number | null;
  performedAt: string;
  performedBy: string;
  performedByName: string;
  entity: string;
  entityId: string;
  action: string;
  changes: Record<string, unknown>;
  ip: string;
}

interface VerifyResult { checked: number; ok: boolean; problems: string[]; unsealed: number }

const ENTITY_LABELS: Record<string, string> = {
  auth: 'ログイン', employee: '従業員', employeeMyNumber: '個人番号', company: '会社情報', filing: '届出',
  filingArchive: '保存原本', approvalRequest: '承認', invitation: '招待', user: '利用者', auditLog: '監査ログ',
  salary: '給与', bonus: '賞与', grade: '等級', dependent: '扶養', report: '帳票', procedure: '手続き', office: '事業所',
};

const ACTION_LABELS: Record<string, string> = {
  create: '登録', update: '変更', delete: '削除', view: '閲覧', login: 'ログイン', logout: 'ログアウト',
  loginFailed: 'ログイン失敗', loginLockedNow: 'ロック', loginLocked: 'ロック中の拒否', loginRejected: 'ログイン拒否',
  loginUnlock: 'ロック解除', sessionRevoke: '端末の切断', passwordChange: 'パスワード変更',
  invitationAccept: '招待の受諾', invitationReissue: '招待の再発行', invite: '招待',
  pdfGenerate: 'PDF出力', zipDownload: 'ZIP出力', csvExport: 'CSV出力', search: '検索',
  approve: '承認', reject: '差戻し', submit: '提出',
};

/** 絞り込みの「種類」の選択肢（entity か entity.action） */
const KINDS: { value: string; label: string }[] = [
  { value: 'auth', label: 'ログイン・ログアウト' },
  { value: 'employeeMyNumber', label: '個人番号（登録・閲覧）' },
  { value: 'employee', label: '従業員' },
  { value: 'filing', label: '届出（PDF出力・検索を含む）' },
  { value: 'filingArchive', label: '保存原本・ZIP' },
  { value: 'company', label: '会社情報（設定）' },
  { value: 'invitation', label: '招待' },
  { value: 'auditLog', label: '監査ログの出力' },
];

/** 監査ログ（管理者だけ。カタログ14章）。期間・操作者・種類で絞り込み、CSV で出力し、改ざんがないか確かめる */
@Component({
  selector: 'app-audit-log',
  standalone: true,
  imports: [MatCardModule, MatDatepickerModule, DatePipe, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <div class="section"><mat-card class="settings-card">
      <div class="filters">
        <mat-form-field appearance="outline"><mat-label>開始日</mat-label>
          <input matInput name="from" [(ngModel)]="from" [matDatepicker]="dp1" placeholder="YYYY/MM/DD"><mat-datepicker-toggle matIconSuffix [for]="dp1" /><mat-datepicker #dp1 /></mat-form-field>
        <mat-form-field appearance="outline"><mat-label>終了日</mat-label>
          <input matInput name="to" [(ngModel)]="to" [matDatepicker]="dp2" placeholder="YYYY/MM/DD"><mat-datepicker-toggle matIconSuffix [for]="dp2" /><mat-datepicker #dp2 /></mat-form-field>
        <mat-form-field appearance="outline"><mat-label>操作者</mat-label>
          <mat-select name="actor" [(ngModel)]="actorUid">
            <mat-option value="">すべて</mat-option>
            @for (u of users(); track u.id) { <mat-option [value]="u.id">{{ u.displayName }}</mat-option> }
          </mat-select></mat-form-field>
        <mat-form-field appearance="outline"><mat-label>種類</mat-label>
          <mat-select name="kind" [(ngModel)]="kind">
            <mat-option value="">すべて</mat-option>
            @for (k of kinds; track k.value) { <mat-option [value]="k.value">{{ k.label }}</mat-option> }
          </mat-select></mat-form-field>
        <div class="buttons">
          <button mat-flat-button color="primary" type="button" (click)="search()" [disabled]="loading()">絞り込む</button>
          <button mat-stroked-button type="button" (click)="exportCsv()" [disabled]="exporting()">CSVで出力</button>
          <button mat-button type="button" (click)="verify()" [disabled]="verifying()">改ざんがないか確かめる</button>
        </div>
      </div>

      @if (verifyResult(); as v) {
        <p class="verify" [class.ng]="!v.ok" data-testid="verify-result">
          @if (v.ok) { {{ v.checked }}件の記録をたどり、書き換え・抜けはありませんでした。 } @else { 問題が見つかりました：{{ v.problems.join('／') }} }
          @if (v.unsealed > 0) { （通し番号を振る前の記録が{{ v.unsealed }}件あります。段階8より前の記録です） }
        </p>
      }
      @if (error()) { <p class="error">{{ error() }}</p> }

      <table class="logs">
        <thead><tr><th>日時</th><th>操作者</th><th>操作</th><th>対象</th><th>内容</th><th>IP</th></tr></thead>
        <tbody>
          @for (row of logs(); track row.id) {
            <tr>
              <td class="nowrap">{{ row.performedAt | date: 'yyyy/MM/dd HH:mm:ss' }}</td>
              <td>{{ row.performedByName || (row.performedBy === 'anonymous' ? '（ログイン前）' : row.performedBy) }}</td>
              <td class="nowrap">{{ operationLabel(row) }}</td>
              <td class="small">{{ targetLabel(row) }}</td>
              <td class="small">{{ summary(row.changes) }}</td>
              <td class="small">{{ row.ip }}</td>
            </tr>
          } @empty {
            <tr><td colspan="6" class="empty">{{ loading() ? '読み込み中…' : '当てはまる記録はありません' }}</td></tr>
          }
        </tbody>
      </table>
      @if (hasMore()) {
        <div class="more"><button mat-stroked-button type="button" (click)="load(true)" [disabled]="loading()">さらに読み込む</button></div>
      }
      <p class="note">監査ログは消したり書き換えたりできません（5年以上保存）。個人番号の値は記録せず、登録・閲覧した事実と理由だけを残します。</p>
    </mat-card></div>
  `,
  styles: [`
    .section { padding: 24px 0; }
    .filters { display: flex; flex-wrap: wrap; gap: 0 12px; align-items: flex-start; }
    .buttons { display: flex; gap: 8px; align-items: center; height: 56px; flex-wrap: wrap; }
    .logs { width: 100%; border-collapse: collapse; font-size: var(--app-font-sm); background: var(--app-color-surface); }
    .logs th, .logs td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--app-color-border); vertical-align: top; }
    .logs th { color: var(--app-color-text-sub); font-weight: 600; }
    .nowrap { white-space: nowrap; }
    .small { font-size: var(--app-font-xs); color: var(--app-color-text-sub); word-break: break-all; max-width: 320px; }
    .empty { text-align: center; padding: 32px; color: var(--app-color-text-sub); }
    .more { text-align: center; padding: 16px; }
    .verify { padding: 8px 12px; border-radius: var(--app-radius); background: var(--app-status-done-bg); color: var(--app-status-done-fg); }
    .verify.ng { background: var(--app-status-error-bg); color: var(--app-status-error-fg); }
    .error { color: var(--app-status-error-fg); }
    .note { margin-top: 12px; font-size: var(--app-font-xs); color: var(--app-color-text-sub); }
  `],
})
export class AuditLogComponent implements OnInit {
  private functions = inject(Functions);
  private auth = inject(AuthService);
  private snackBar = inject(MatSnackBar);

  logs = signal<AuditLogRow[]>([]);
  users = signal<{ id: string; displayName: string }[]>([]);
  loading = signal(false);
  exporting = signal(false);
  verifying = signal(false);
  hasMore = signal(false);
  error = signal('');
  verifyResult = signal<VerifyResult | null>(null);
  kinds = KINDS;
  from = '';
  to = '';
  actorUid = '';
  kind = '';
  private lastDocId: string | undefined;

  ngOnInit() {
    void this.load(false);
    void this.loadUsers();
  }

  entityLabel(e: string) { return ENTITY_LABELS[e] ?? e; }
  actionLabel(a: string) { return ACTION_LABELS[a] ?? a; }
  /** 「ログイン・ログイン」のように重なるときは操作の名前だけ */
  operationLabel(row: AuditLogRow) {
    const entity = this.entityLabel(row.entity), action = this.actionLabel(row.action);
    return action.startsWith(entity) ? action : `${entity}・${action}`;
  }
  /** 対象が利用者のIDなら名前を出す（ログイン前の失敗は「—」） */
  targetLabel(row: AuditLogRow) {
    if (row.entityId === 'anonymous') return '—';
    const user = this.users().find(u => u.id === row.entityId);
    return user ? user.displayName : row.entityId;
  }

  /** 内容の短い要約（変更は「項目：前→後」、ほかは値を並べる） */
  summary(changes: Record<string, unknown>): string {
    return Object.entries(changes ?? {}).map(([k, v]) => {
      if (v && typeof v === 'object' && 'from' in (v as object) && 'to' in (v as object)) {
        const c = v as { from: unknown; to: unknown };
        return `${k}：${this.short(c.from)}→${this.short(c.to)}`;
      }
      return `${k}：${this.short(v)}`;
    }).join('、');
  }

  private short(v: unknown): string {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return s && s.length > 60 ? s.slice(0, 60) + '…' : s ?? '';
  }

  private filter() {
    return {
      companyId: this.auth.companyId,
      ...(this.from ? { from: this.from } : {}),
      ...(this.to ? { to: this.to } : {}),
      ...(this.actorUid ? { actorUid: this.actorUid } : {}),
      ...(this.kind ? { kind: this.kind } : {}),
    };
  }

  search() {
    this.verifyResult.set(null);
    void this.load(false);
  }

  async load(append: boolean) {
    this.loading.set(true);
    this.error.set('');
    try {
      const fn = httpsCallable<object, { items: AuditLogRow[]; hasMore: boolean; lastDocId?: string }>(this.functions, 'auditLogList');
      const { data } = await fn({ ...this.filter(), limit: 50, ...(append && this.lastDocId ? { lastDocId: this.lastDocId } : {}) });
      this.logs.set(append ? [...this.logs(), ...data.items] : data.items);
      this.hasMore.set(data.hasMore);
      this.lastDocId = data.lastDocId;
    } catch (e: any) {
      this.error.set(`監査ログを取得できませんでした：${e?.message ?? ''}`);
    } finally {
      this.loading.set(false);
    }
  }

  private async loadUsers() {
    try {
      const { data } = await httpsCallable<object, { users: { id: string; displayName: string }[] }>(this.functions, 'userList')({ companyId: this.auth.companyId });
      this.users.set(data.users);
    } catch { /* 操作者の選択肢がなくても一覧は使える */ }
  }

  async exportCsv() {
    this.exporting.set(true);
    try {
      const { data } = await httpsCallable<object, { csv: string; count: number; truncated: boolean }>(this.functions, 'auditLogExport')(this.filter());
      const url = URL.createObjectURL(new Blob([data.csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      this.snackBar.open(`${data.count}件を出力しました${data.truncated ? '（多すぎるため途中まで。期間を絞ってください）' : ''}`, '閉じる', { duration: 5000 });
    } catch (e: any) {
      this.snackBar.open(`出力できませんでした：${e?.message ?? ''}`, '閉じる', { duration: 6000 });
    } finally {
      this.exporting.set(false);
    }
  }

  async verify() {
    this.verifying.set(true);
    try {
      const { data } = await httpsCallable<object, VerifyResult>(this.functions, 'auditLogVerify', { timeout: 300000 })({ companyId: this.auth.companyId });
      this.verifyResult.set(data);
    } catch (e: any) {
      this.snackBar.open(`確かめられませんでした：${e?.message ?? ''}`, '閉じる', { duration: 6000 });
    } finally {
      this.verifying.set(false);
    }
  }
}
