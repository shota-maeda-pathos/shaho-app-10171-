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
import { MatDialog } from '@angular/material/dialog';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../../core/services/auth.service';
import type { FilingPrintMeta } from '../templates/official-filing-pdf';
import { FilingSubmissionComponent } from '../submission/filing-submission';

const FILING_TYPE_LABELS: Record<string, string> = {
  acquisitionNotification: '被保険者資格取得届',
  lossNotification: '被保険者資格喪失届',
  remunerationMonthlyChange: '報酬月額変更届',
  remunerationMonthlyAlgorithm: '報酬月額算定基礎届',
  dependentChange: '被扶養者（異動）届',
  bonusPayment: '賞与支払届',
  maternityLeaveStart: '産前産後休業取得者申出書',
  childcareLeaveStart: '育児休業等取得者申出書',
  maternityLeaveChange: '産前産後休業取得者変更（終了）届',
  maternityLeaveEndChange: '産前産後休業終了時報酬月額変更届',
  childcareLeaveEndChange: '育児休業等終了時報酬月額変更届',
  pensionLoss70: '資格喪失届・70歳以上被用者該当届',
  childcareLeaveEnd: '育児休業等取得者終了届',
};

const WORKFLOW_STATUS_LABELS: Record<string, string> = {
  draft: '下書き', pending: '承認待ち', approved: '承認済', rejected: '差戻し',
};
@Component({
  selector: 'app-filing-detail',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule, MatIconModule, MatCardModule, MatChipsModule,
    MatDividerModule, MatProgressSpinnerModule, MatSnackBarModule, MatStepperModule, FilingSubmissionComponent,
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
          <h2>社内承認</h2>
          <p>{{ workflowLabel(filing()!.workflowStatus) }}</p>
          <div class="action-buttons">
            @if (filing()!.workflowStatus === 'draft') {
              <button mat-flat-button color="primary" (click)="requestApproval()" [disabled]="processing()">
                <mat-icon>send</mat-icon> 承認申請
              </button>
            }
            <button mat-stroked-button (click)="printPdf()" [disabled]="processing()">
              <mat-icon>picture_as_pdf</mat-icon> {{ processing() ? '処理中…' : '公式PDFを確認・保存' }}
            </button>
          </div>
        </mat-card>

        <mat-card class="actions-card">
          <h2>提出</h2>
          <app-filing-submission [target]="{ source: 'employee', parentId: employeeId, filingId: filingId }" (changed)="loadFiling(true)" />
        </mat-card>

        @if (filing()!.formData && objectKeys(filing()!.formData).length > 0) {
          <mat-card class="data-card">
            <h2>届出データ</h2>
            <div class="data-grid">
              @for (key of objectKeys(filing()!.formData); track key) {
                @if (!isArrayValue(filing()!.formData[key])) {
                  <div class="data-item">
                    <label>{{ key }}</label>
                    <span>{{ formatValue(filing()!.formData[key]) }}</span>
                  </div>
                }
              }
            </div>
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
    .error-card { border-left: 4px solid #f44336; }
    .error-list { margin: 0; padding-left: 20px; color: #c62828; }
    .error-list li { margin-bottom: 4px; }
  `],
})
export class FilingDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private functions = inject(Functions);
  private snackBar = inject(MatSnackBar);
  private auth = inject(AuthService);
  private dialog = inject(MatDialog);

  filing = signal<any>(null);
  loading = signal(false);
  processing = signal(false);

  employeeId = '';
  filingId = '';

  objectKeys = Object.keys;

  formatValue(v: unknown): string {
    if (v == null) return '—';
    if (typeof v === 'number') return v.toLocaleString('ja-JP');
    return String(v);
  }

  isArrayValue(v: unknown): boolean {
    return Array.isArray(v);
  }

  ngOnInit() {
    this.filingId = this.route.snapshot.paramMap.get('filingId') ?? '';
    this.employeeId = this.route.snapshot.queryParamMap.get('employeeId') ?? '';
    this.loadFiling();
  }

  filingTypeLabel(type: string): string { return FILING_TYPE_LABELS[type] ?? type; }
  workflowLabel(s: string): string { return WORKFLOW_STATUS_LABELS[s] ?? s; }

  async requestApproval() {
    this.processing.set(true);
    try {
      const fn = httpsCallable(this.functions, 'approvalRequestCreate');
      await fn({
        companyId: this.auth.companyId,
        employeeId: this.employeeId,
        targetPath: `companies/${this.auth.companyId}/employees/${this.employeeId}/filings/${this.filingId}`,
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

  async printPdf() {
    if (this.processing()) return;
    this.processing.set(true);
    try {
      const fn = httpsCallable<any, any>(this.functions, 'filingPdfData');
      const result = await fn({
        companyId: this.auth.companyId,
        employeeId: this.employeeId,
        filingId: this.filingId,
      });
      const d = result.data;
      const [companyResult, employeeResult] = await Promise.all([
        httpsCallable<{ companyId: string }, { representativeName: string }>(this.functions, 'companyGet')({ companyId: this.auth.companyId }),
        httpsCallable<{ companyId: string; employeeId: string }, { officeId: string }>(this.functions, 'employeeGet')({ companyId: this.auth.companyId, employeeId: this.employeeId }),
      ]);
      const { data: officeData } = await httpsCallable<object, { items: { id: string; name: string; officeNumber: string; address: string; phone: string }[] }>(this.functions, 'officeList')({ companyId: this.auth.companyId, includeInactive: true });
      const office = officeData.items.find(item => item.id === employeeResult.data.officeId);
      if (!office) throw new Error('届出の事業所情報を取得できませんでした。');
      const meta: FilingPrintMeta = {
        companyName: d.companyName,
        officeName: office.name,
        officeNumber: office.officeNumber,
        officeAddress: office.address,
        officePhone: office.phone,
        representativeName: companyResult.data.representativeName,
        effectiveDate: d.effectiveDate,
        employeeNumber: d.employeeNumber,
      };
      const [{ createOfficialFilingPdf, OFFICIAL_FORMS }, { OfficialPdfPreviewComponent }] = await Promise.all([
        import('../templates/official-filing-pdf'), import('../templates/official-pdf-preview'),
      ]);
      const output = await createOfficialFilingPdf(d.filingType, d.formData ?? {}, meta);
      const form = OFFICIAL_FORMS[d.filingType];
      this.dialog.open(OfficialPdfPreviewComponent, {
        width: '1100px', height: '94vh', maxWidth: '96vw',
        data: { ...output, title: form.title,
          filename: `${form.title}_${this.filingId.replace(/[^a-zA-Z0-9_-]/g, '')}.pdf`,
          sourceUrl: `https://www.nenkin.go.jp/shinsei/kounen/tekiyo/${form.source}`,
          originalUrl: `/filing-forms/${form.file}.pdf`,
        },
      });
    } catch (e: any) {
      this.snackBar.open(`エラー: ${e.message}`, '閉じる', { duration: 5000 });
    } finally {
      this.processing.set(false);
    }
  }

  goBack() {
    this.router.navigate(['/filings']);
  }

  async loadFiling(silent = false) {
    if (!silent) this.loading.set(true);
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
