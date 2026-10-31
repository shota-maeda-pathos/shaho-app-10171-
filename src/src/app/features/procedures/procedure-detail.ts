import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../core/services/auth.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm-dialog';
import { wizardRoute } from './wizard-route';

interface StepInfo {
  id: string;
  label: string;
  type: string;
  dependsOn: string[];
  isConditional: boolean;
  condition: string | null;
  status: string;
  statusDetail: string | null;
  referenceType: string | null;
  referenceId: string | null;
  referenceStatus: string | null;
  actionLabel: string | null;
  actionRoute: string | null;
  completedAt: string | null;
  completedBy: string | null;
}

interface ProcedureDetail {
  id: string;
  procedureType: string;
  title: string;
  priority: string;
  status: string;
  statusReason: string;
  employeeId: string | null;
  employeeName: string;
  officeId: string;
  steps: StepInfo[];
  deadline: string | null;
  effectiveDate: string | null;
  assignedTo: string;
  createdBy: string;
  notes: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

const PROCEDURE_TYPE_LABELS: Record<string, string> = {
  acquisition: '入社手続き',
  loss: '退職手続き',
  dependent_change: '扶養異動',
  maternity_leave: '産前産後休業',
  childcare_leave: '育児休業',
  monthly_change: '随時改定',
  annual_review: '算定基礎届',
  bonus_payment: '賞与支払届',
  transfer: '異動手続き',
  age_event: '年齢到達手続き',
  employment_change: '雇用条件の変更',
};

const STATUS_LABELS: Record<string, string> = {
  draft: '下書き',
  in_progress: '進行中',
  completed: '完了',
  cancelled: '取消',
};

const STEP_STATUS_LABELS: Record<string, string> = {
  blocked: '待機中',
  available: '着手可能',
  in_progress: '進行中',
  completed: '完了',
  skipped: 'スキップ',
  returned: '差戻し',
};

const STEP_STATUS_ICONS: Record<string, string> = {
  blocked: 'lock',
  available: 'play_circle',
  in_progress: 'pending',
  completed: 'check_circle',
  skipped: 'skip_next',
  returned: 'replay',
};

@Component({
  selector: 'app-procedure-detail',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule, MatButtonModule, MatIconModule,
    MatProgressSpinnerModule, MatChipsModule, MatDividerModule,
    MatSnackBarModule,
  ],
  template: `
    <div class="page-container">
      @if (error()) { <p role="alert">{{ error() }}</p><button mat-stroked-button (click)="loadProcedure()">再読み込み</button> }
      @if (loading()) {
        <div class="loading-container">
          <mat-spinner diameter="40"></mat-spinner>
        </div>
      } @else if (procedure()) {
        <div class="page-header">
          <div class="header-left">
            <button mat-icon-button (click)="goBack()">
              <mat-icon>arrow_back</mat-icon>
            </button>
            <div>
              <h1>{{ procedure()!.title }}</h1>
              <span class="subtitle">{{ typeLabel(procedure()!.procedureType) }}</span>
            </div>
          </div>
          <div class="header-right">
            <span class="status-chip" [attr.data-status]="procedure()!.status">
              {{ statusLabel(procedure()!.status) }}
            </span>
            @if (procedure()!.status === 'in_progress' && auth.hasAnyRole('admin', 'operator')) {
              <button mat-stroked-button color="warn" (click)="cancelProcedure()" [disabled]="acting()">
                <mat-icon>cancel</mat-icon> 取消
              </button>
            }
          </div>
        </div>

        <div class="content-grid">
          <mat-card class="info-card">
            <mat-card-header>
              <mat-card-title>基本情報</mat-card-title>
            </mat-card-header>
            <mat-card-content>
              <dl class="info-list">
                <dt>従業員</dt>
                <dd>
                  @if (procedure()!.employeeId) {
                    <a class="link" (click)="navigateToEmployee()">{{ procedure()!.employeeName }}</a>
                  } @else {
                    {{ procedure()!.employeeName }}
                  }
                </dd>
                <dt>適用日</dt>
                <dd>{{ procedure()!.effectiveDate ?? '—' }}</dd>
                <dt>期限</dt>
                <dd>{{ procedure()!.deadline ?? '—' }}</dd>
                <dt>優先度</dt>
                <dd>
                  <span class="priority-chip" [attr.data-priority]="procedure()!.priority">
                    {{ procedure()!.priority === 'high' ? '高' : procedure()!.priority === 'low' ? '低' : '通常' }}
                  </span>
                </dd>
                <dt>現在の状況</dt>
                <dd>{{ procedure()!.statusReason }}</dd>
                <dt>作成日</dt>
                <dd>{{ procedure()!.createdAt | date:'yyyy/MM/dd HH:mm' }}</dd>
                @if (procedure()!.completedAt) {
                  <dt>完了日</dt>
                  <dd>{{ procedure()!.completedAt | date:'yyyy/MM/dd HH:mm' }}</dd>
                }
              </dl>
            </mat-card-content>
          </mat-card>

          <mat-card class="steps-card">
            <mat-card-header>
              <mat-card-title>ステップ</mat-card-title>
            </mat-card-header>
            <mat-card-content>
              <div class="steps-timeline">
                @for (step of procedure()!.steps; track step.id) {
                  <div class="step-item" [attr.data-status]="step.status">
                    <div class="step-icon">
                      <mat-icon [class]="'step-icon-' + step.status">
                        {{ stepIcon(step.status) }}
                      </mat-icon>
                    </div>
                    <div class="step-content">
                      <div class="step-header">
                        <span class="step-label">{{ step.label }}</span>
                        <span class="step-status-badge" [attr.data-status]="step.status">
                          {{ stepStatusLabel(step.status) }}
                        </span>
                      </div>
                      @if (step.statusDetail) {
                        <div class="step-detail">{{ step.statusDetail }}</div>
                      }
                      @if (step.isConditional && step.condition) {
                        <div class="step-condition">条件: {{ step.condition }}</div>
                      }
                      @if (step.completedAt) {
                        <div class="step-completed">{{ step.completedAt | date:'yyyy/MM/dd HH:mm' }} 完了</div>
                      }
                      @if (step.actionLabel && (step.status === 'available' || step.status === 'in_progress' || step.status === 'returned') && procedure()!.status === 'in_progress' && (auth.hasAnyRole('admin','operator') || step.type === 'approval')) {
                        <button mat-stroked-button class="step-action" (click)="handleStepAction(step)" [disabled]="acting()">
                          {{ step.actionLabel }}
                        </button>
                      }
                    </div>
                  </div>
                }
              </div>
            </mat-card-content>
          </mat-card>
        </div>
      } @else {
        <div class="empty-state">
          <mat-icon>error_outline</mat-icon>
          <p>手続きが見つかりません</p>
          <button mat-stroked-button (click)="goBack()">一覧に戻る</button>
        </div>
      }
    </div>
  `,
  styles: [`
    .page-container { padding: 24px; }
    .loading-container { display: flex; justify-content: center; padding: 48px; }
    .page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
    .header-left { display: flex; align-items: center; gap: 8px; }
    .header-left h1 { margin: 0; font-size: 24px; font-weight: 500; }
    .subtitle { font-size: 14px; color: #666; }
    .header-right { display: flex; align-items: center; gap: 12px; }
    .status-chip { padding: 6px 16px; border-radius: 16px; font-size: 13px; font-weight: 500; background: #f5f5f5; }
    .status-chip[data-status="in_progress"] { background: var(--app-brand-tint); color: var(--app-brand-strong); }
    .status-chip[data-status="completed"] { background: #e8f5e9; color: #2e7d32; }
    .status-chip[data-status="cancelled"] { background: #f5f5f5; color: #757575; }

    .content-grid { display: grid; grid-template-columns: 320px 1fr; gap: 24px; }
    @media (max-width: 960px) { .content-grid { grid-template-columns: 1fr; } }

    .info-card mat-card-content { padding-top: 16px; }
    .info-list { display: grid; grid-template-columns: auto 1fr; gap: 8px 16px; margin: 0; }
    .info-list dt { color: #666; font-size: 13px; }
    .info-list dd { margin: 0; font-size: 14px; }

    .priority-chip[data-priority="high"] { color: #c62828; font-weight: 500; }
    .priority-chip[data-priority="low"] { color: #757575; }

    .link { color: var(--app-brand-strong); cursor: pointer; text-decoration: none; }
    .link:hover { text-decoration: underline; }

    .steps-card mat-card-content { padding-top: 16px; }
    .steps-timeline { display: flex; flex-direction: column; gap: 0; }
    .step-item { display: flex; gap: 12px; padding: 12px 0; border-bottom: 1px solid #f0f0f0; }
    .step-item:last-child { border-bottom: none; }
    .step-icon { flex-shrink: 0; padding-top: 2px; }
    .step-icon-blocked { color: #bdbdbd; }
    .step-icon-available { color: var(--app-brand-strong); }
    .step-icon-in_progress { color: #f57c00; }
    .step-icon-completed { color: #2e7d32; }
    .step-icon-skipped { color: #9e9e9e; }
    .step-icon-returned { color: #c62828; }

    .step-content { flex: 1; }
    .step-header { display: flex; align-items: center; gap: 8px; }
    .step-label { font-size: 14px; font-weight: 500; }
    .step-status-badge { font-size: 11px; padding: 2px 8px; border-radius: 10px; background: #f5f5f5; }
    .step-status-badge[data-status="available"] { background: var(--app-brand-tint); color: var(--app-brand-strong); }
    .step-status-badge[data-status="in_progress"] { background: #fff3e0; color: #e65100; }
    .step-status-badge[data-status="completed"] { background: #e8f5e9; color: #2e7d32; }
    .step-status-badge[data-status="returned"] { background: #ffebee; color: #c62828; }
    .step-detail { font-size: 13px; color: #555; margin-top: 4px; }
    .step-condition { font-size: 12px; color: #999; font-style: italic; margin-top: 2px; }
    .step-completed { font-size: 12px; color: #888; margin-top: 4px; }
    .step-action { margin-top: 8px; }

    .empty-state { text-align: center; padding: 48px; color: #666; }
    .empty-state mat-icon { font-size: 48px; width: 48px; height: 48px; color: #ccc; }
  `],
})
export class ProcedureDetailComponent implements OnInit {
  private functions = inject(Functions);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private snackBar = inject(MatSnackBar);
  private confirm = inject(ConfirmService);
  auth = inject(AuthService);

  procedure = signal<ProcedureDetail | null>(null);
  loading = signal(false);
  error = signal('');
  acting = signal(false);

  private procedureId = '';

  ngOnInit() {
    this.procedureId = this.route.snapshot.paramMap.get('id') ?? '';
    this.loadProcedure();
  }

  typeLabel(type: string): string { return PROCEDURE_TYPE_LABELS[type] ?? type; }
  statusLabel(status: string): string { return STATUS_LABELS[status] ?? status; }
  stepStatusLabel(status: string): string { return STEP_STATUS_LABELS[status] ?? status; }
  stepIcon(status: string): string { return STEP_STATUS_ICONS[status] ?? 'help'; }

  goBack() {
    this.router.navigate(['/procedures']);
  }

  navigateToEmployee() {
    const empId = this.procedure()?.employeeId;
    if (empId) this.router.navigate(['/employees', empId]);
  }

  handleStepAction(step: StepInfo) {
    const proc = this.procedure();
    if (!proc) return;
    if (step.status === 'blocked' || proc.status === 'completed' || proc.status === 'cancelled') return;
    if (step.type === 'confirmation') { void this.confirmStep(step); return; }
    if (step.type === 'approval' && !this.auth.hasAnyRole('admin', 'operator')) { this.router.navigate(['/approvals']); return; }

    if (step.actionRoute) {
      this.router.navigateByUrl(step.actionRoute);
      return;
    }

    if (step.type === 'mock_filing' && step.referenceId && proc.employeeId) {
      this.router.navigate(['/filings', step.referenceId], {
        queryParams: { employeeId: proc.employeeId },
      });
    } else if (step.type === 'paper_submit' && step.referenceId && proc.employeeId) {
      this.router.navigate(['/filings', step.referenceId], {
        queryParams: { employeeId: proc.employeeId },
      });
    } else if (step.type === 'approval' && step.referenceId) {
      this.router.navigate(['/approvals']);
    }
  }

  async confirmStep(step: StepInfo) {
    const proc = this.procedure();
    if (!proc || this.acting()) return;
    this.acting.set(true); this.error.set('');
    try {
      await httpsCallable(this.functions, 'procedureAction')({ companyId: this.auth.companyId, procedureId: this.procedureId, stepId: step.id, expectedVersion: proc.version });
      await this.loadProcedure();
    } catch (e: any) { this.error.set(e.message ?? '完了確認に失敗しました'); }
    finally { this.acting.set(false); }
  }

  async cancelProcedure() {
    const proc = this.procedure();
    if (!proc) return;
    const ok = await this.confirm.ask({ title: 'この手続きを取り消す', message: `「${proc.title}」を取り消します。`, notice: '取り消した手続きは、やることや一覧に出なくなります。', confirmLabel: '取り消す', warn: true });
    if (!ok) return;

    try {
      const fn = httpsCallable(this.functions, 'procedureCancel');
      await fn({
        companyId: this.auth.companyId,
        procedureId: this.procedureId,
        reason: '手動取消',
        expectedVersion: proc.version,
      });
      this.snackBar.open('手続きを取消しました', '閉じる', { duration: 3000 });
      this.loadProcedure();
    } catch (e: any) {
      this.snackBar.open(`エラー: ${e.message}`, '閉じる', { duration: 5000 });
    }
  }

  async loadProcedure() {
    this.loading.set(true);
    this.error.set('');
    try {
      const fn = httpsCallable<any, ProcedureDetail>(this.functions, 'procedureGet');
      const { data } = await fn({
        companyId: this.auth.companyId,
        procedureId: this.procedureId,
      });
      // ウィザード方式の手続きは、それぞれの画面で進める（旧方式の手続きだけこの画面で見る）
      const route = wizardRoute(data.procedureType, data.steps.map(s => s.id));
      if (route) {
        void this.router.navigate([route, this.procedureId], { replaceUrl: true });
        return;
      }
      this.procedure.set(data);
    } catch (e: any) {
      this.procedure.set(null);
      this.error.set(e.message ?? '手続きを取得できませんでした');
    } finally {
      this.loading.set(false);
    }
  }
}
