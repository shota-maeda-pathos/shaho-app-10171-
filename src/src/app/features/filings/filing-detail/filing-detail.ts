import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatStepperModule } from '@angular/material/stepper';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../../core/services/auth.service';

const FILING_TYPE_LABELS: Record<string, string> = {
  acquisitionHealth: '健保 資格取得届',
  acquisitionPension: '厚年 資格取得届',
  lossHealth: '健保 資格喪失届',
  lossPension: '厚年 資格喪失届',
  monthlySantei: '算定基礎届',
  monthlyChange: '月額変更届',
  bonusReport: '賞与支払届',
  dependentAdd: '被扶養者（異動）届',
  dependentRemove: '被扶養者 削除届',
};

const WORKFLOW_STATUS_LABELS: Record<string, string> = {
  draft: '下書き', pending: '承認待ち', approved: '承認済', rejected: '差戻し',
};
const MOCK_STATUS_LABELS: Record<string, string> = {
  notStarted: '未実施', processing: '処理中', completed: '完了', failed: 'エラー',
};
const SUBMISSION_STATUS_LABELS: Record<string, string> = {
  notSubmitted: '未提出', submitted: '提出済', accepted: '受理', returned: '返戻',
};

@Component({
  selector: 'app-filing-detail',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule, MatIconModule, MatCardModule, MatChipsModule,
    MatDividerModule, MatProgressSpinnerModule, MatSnackBarModule, MatStepperModule,
  ],
  template: `
    <div class="page-container">
      <div class="page-header">
        <button mat-icon-button (click)="goBack()"><mat-icon>arrow_back</mat-icon></button>
        <h1>届出詳細</h1>
      </div>

      @if (loading()) {
        <div class="loading-container"><mat-spinner diameter="40"></mat-spinner></div>
      } @else if (filing()) {
        <mat-card class="info-card">
          <div class="info-grid">
            <div class="info-item">
              <label>届出種類</label>
              <span>{{ filingTypeLabel(filing()!.filingType) }}</span>
            </div>
            <div class="info-item">
              <label>対象従業員</label>
              <span>{{ filing()!.employeeName }}</span>
            </div>
            <div class="info-item">
              <label>届出日</label>
              <span>{{ filing()!.effectiveDate }}</span>
            </div>
            <div class="info-item">
              <label>作成日</label>
              <span>{{ filing()!.createdAt | date:'yyyy/MM/dd HH:mm' }}</span>
            </div>
          </div>
        </mat-card>

        <mat-card class="status-card">
          <h2>処理状況</h2>
          <div class="status-steps">
            <div class="status-step" [class.active]="true">
              <div class="step-icon" [class]="'ws-' + filing()!.workflowStatus">
                <mat-icon>{{ filing()!.workflowStatus === 'approved' ? 'check_circle' : 'pending' }}</mat-icon>
              </div>
              <div class="step-content">
                <span class="step-label">社内承認</span>
                <span class="step-value">{{ workflowLabel(filing()!.workflowStatus) }}</span>
              </div>
            </div>
            <div class="step-connector"></div>
            <div class="status-step">
              <div class="step-icon" [class]="'ms-' + filing()!.mockStatus">
                <mat-icon>{{ filing()!.mockStatus === 'completed' ? 'check_circle' : 'science' }}</mat-icon>
              </div>
              <div class="step-content">
                <span class="step-label">模擬申請</span>
                <span class="step-value">{{ mockLabel(filing()!.mockStatus) }}</span>
              </div>
            </div>
            <div class="step-connector"></div>
            <div class="status-step">
              <div class="step-icon" [class]="'ss-' + filing()!.submissionStatus">
                <mat-icon>{{ filing()!.submissionStatus === 'accepted' ? 'check_circle' : 'send' }}</mat-icon>
              </div>
              <div class="step-content">
                <span class="step-label">提出</span>
                <span class="step-value">{{ submissionLabel(filing()!.submissionStatus) }}</span>
              </div>
            </div>
          </div>
        </mat-card>

        <mat-card class="actions-card">
          <h2>操作</h2>
          <div class="action-buttons">
            @if (filing()!.workflowStatus === 'draft') {
              <button mat-flat-button color="primary" (click)="requestApproval()" [disabled]="processing()">
                <mat-icon>send</mat-icon> 承認申請
              </button>
            }
            @if (filing()!.workflowStatus === 'approved' && filing()!.submissionStatus === 'notSubmitted') {
              <button mat-flat-button color="primary" (click)="submitFiling()" [disabled]="processing()">
                <mat-icon>upload_file</mat-icon> 提出記録
              </button>
            }
            @if (filing()!.submissionStatus === 'submitted') {
              <button mat-flat-button color="accent" (click)="recordResult(true)" [disabled]="processing()">
                <mat-icon>check</mat-icon> 受理記録
              </button>
              <button mat-stroked-button color="warn" (click)="recordResult(false)" [disabled]="processing()">
                <mat-icon>reply</mat-icon> 返戻記録
              </button>
            }
          </div>
        </mat-card>

        @if (filing()!.formData && objectKeys(filing()!.formData).length > 0) {
          <mat-card class="data-card">
            <h2>届出データ</h2>
            <div class="data-grid">
              @for (key of objectKeys(filing()!.formData); track key) {
                <div class="data-item">
                  <label>{{ key }}</label>
                  <span>{{ filing()!.formData[key] }}</span>
                </div>
              }
            </div>
          </mat-card>
        }

        @if (filing()!.resultNote) {
          <mat-card class="result-card">
            <h2>結果メモ</h2>
            <p>{{ filing()!.resultNote }}</p>
          </mat-card>
        }
      }
    </div>
  `,
  styles: [`
    .page-container { padding: 24px; }
    .page-header { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
    .page-header h1 { margin: 0; font-size: 24px; font-weight: 500; }
    .loading-container { display: flex; justify-content: center; padding: 48px; }
    mat-card { padding: 24px; margin-bottom: 16px; }
    h2 { font-size: 16px; font-weight: 500; margin: 0 0 16px; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .info-item { display: flex; flex-direction: column; gap: 4px; }
    .info-item label { font-size: 12px; color: #666; }
    .info-item span { font-size: 14px; font-weight: 500; }
    .status-steps { display: flex; align-items: center; gap: 8px; }
    .status-step { display: flex; align-items: center; gap: 8px; }
    .step-icon { width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: #e0e0e0; }
    .step-icon mat-icon { color: #fff; }
    .ws-approved .step-icon, .step-icon.ws-approved { background: #4caf50; }
    .ws-pending .step-icon, .step-icon.ws-pending { background: #ff9800; }
    .ws-rejected .step-icon, .step-icon.ws-rejected { background: #f44336; }
    .ws-draft .step-icon, .step-icon.ws-draft { background: #9e9e9e; }
    .ms-completed .step-icon, .step-icon.ms-completed { background: #4caf50; }
    .ms-processing .step-icon, .step-icon.ms-processing { background: #2196f3; }
    .ms-failed .step-icon, .step-icon.ms-failed { background: #f44336; }
    .ms-notStarted .step-icon, .step-icon.ms-notStarted { background: #9e9e9e; }
    .ss-accepted .step-icon, .step-icon.ss-accepted { background: #4caf50; }
    .ss-submitted .step-icon, .step-icon.ss-submitted { background: #2196f3; }
    .ss-returned .step-icon, .step-icon.ss-returned { background: #f44336; }
    .ss-notSubmitted .step-icon, .step-icon.ss-notSubmitted { background: #9e9e9e; }
    .step-content { display: flex; flex-direction: column; }
    .step-label { font-size: 11px; color: #666; }
    .step-value { font-size: 13px; font-weight: 500; }
    .step-connector { flex: 1; height: 2px; background: #e0e0e0; min-width: 24px; }
    .action-buttons { display: flex; gap: 12px; flex-wrap: wrap; }
    .data-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .data-item { display: flex; flex-direction: column; gap: 2px; }
    .data-item label { font-size: 12px; color: #666; }
    .data-item span { font-size: 14px; }
    .result-card p { margin: 0; }
  `],
})
export class FilingDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private functions = inject(Functions);
  private snackBar = inject(MatSnackBar);
  private auth = inject(AuthService);

  filing = signal<any>(null);
  loading = signal(false);
  processing = signal(false);

  private employeeId = '';
  private filingId = '';

  objectKeys = Object.keys;

  ngOnInit() {
    this.filingId = this.route.snapshot.paramMap.get('filingId') ?? '';
    this.employeeId = this.route.snapshot.queryParamMap.get('employeeId') ?? '';
    this.loadFiling();
  }

  filingTypeLabel(type: string): string { return FILING_TYPE_LABELS[type] ?? type; }
  workflowLabel(s: string): string { return WORKFLOW_STATUS_LABELS[s] ?? s; }
  mockLabel(s: string): string { return MOCK_STATUS_LABELS[s] ?? s; }
  submissionLabel(s: string): string { return SUBMISSION_STATUS_LABELS[s] ?? s; }

  async requestApproval() {
    this.processing.set(true);
    try {
      const fn = httpsCallable(this.functions, 'approvalRequestCreate');
      await fn({
        companyId: this.auth.companyId,
        employeeId: this.employeeId,
        targetPath: `filings/${this.filingId}`,
        targetVersion: this.filing()?.version ?? 1,
        requestType: 'filing',
        comment: '',
      });
      this.snackBar.open('承認申請しました', '閉じる', { duration: 3000 });
      this.loadFiling();
    } catch (e: any) {
      this.snackBar.open(`エラー: ${e.message}`, '閉じる', { duration: 5000 });
    } finally {
      this.processing.set(false);
    }
  }

  async submitFiling() {
    this.processing.set(true);
    try {
      const fn = httpsCallable(this.functions, 'filingSubmit');
      await fn({
        companyId: this.auth.companyId,
        employeeId: this.employeeId,
        filingId: this.filingId,
        expectedVersion: this.filing()?.version ?? 1,
      });
      this.snackBar.open('提出を記録しました', '閉じる', { duration: 3000 });
      this.loadFiling();
    } catch (e: any) {
      this.snackBar.open(`エラー: ${e.message}`, '閉じる', { duration: 5000 });
    } finally {
      this.processing.set(false);
    }
  }

  async recordResult(accepted: boolean) {
    this.processing.set(true);
    try {
      const fn = httpsCallable(this.functions, 'filingRecordResult');
      await fn({
        companyId: this.auth.companyId,
        employeeId: this.employeeId,
        filingId: this.filingId,
        expectedVersion: this.filing()?.version ?? 1,
        result: accepted ? 'accepted' : 'returned',
        note: '',
      });
      this.snackBar.open(accepted ? '受理を記録しました' : '返戻を記録しました', '閉じる', { duration: 3000 });
      this.loadFiling();
    } catch (e: any) {
      this.snackBar.open(`エラー: ${e.message}`, '閉じる', { duration: 5000 });
    } finally {
      this.processing.set(false);
    }
  }

  goBack() {
    this.router.navigate(['/filings']);
  }

  private async loadFiling() {
    this.loading.set(true);
    try {
      const fn = httpsCallable<any, any>(this.functions, 'filingGet');
      const result = await fn({
        companyId: this.auth.companyId,
        employeeId: this.employeeId,
        filingId: this.filingId,
      });
      this.filing.set(result.data);
    } catch {
      this.filing.set(null);
    } finally {
      this.loading.set(false);
    }
  }
}
