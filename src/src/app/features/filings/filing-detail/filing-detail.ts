import { Component, DestroyRef, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { combineLatest } from 'rxjs';
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
  correction: '訂正届',
  cancellation: '取消届',
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
    RouterLink, FormsModule, MatFormFieldModule, MatInputModule,
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

        @if (isCorrection()) {
          <mat-card class="correction-card">
            <h2>{{ filing()!.filingType === 'correction' ? '訂正届' : '取消届' }}</h2>
            <p>元の届出：<a [routerLink]="['/filings', filing()!.originalFilingId]" [queryParams]="{ employeeId: employeeId }">{{ filingTypeLabel(filing()!.originalFilingType) }}</a></p>
            <p>理由：{{ filing()!.reason }}</p>
            @if (filing()!.filingType === 'correction') {
              <h3>訂正箇所（元の届出との違い）</h3>
              @if (!filing()!.corrections.length) { <p class="muted">まだ直した項目はありません。下の記入内容を直して保存してください。</p> }
              @else {
                <table class="diff">
                  <thead><tr><th>項目</th><th>訂正前</th><th>訂正後</th></tr></thead>
                  <tbody>@for (c of filing()!.corrections; track c.field) { <tr><th>{{ c.field }}</th><td class="before">{{ c.before || '（空欄）' }}</td><td class="after">{{ c.after || '（空欄）' }}</td></tr> }</tbody>
                </table>
              }
            }
            <p class="note">台帳・等級・被扶養者などの登録は自動では直りません。必要なら<a [routerLink]="['/employees', employeeId]">従業員の画面</a>で直してください。</p>
            @if (editable()) {
              @if (filing()!.filingType === 'correction') {
                <h3>記入内容を直す</h3>
                <div class="edit-grid">
                  @for (key of editableKeys(); track key) {
                    <mat-form-field appearance="outline"><mat-label>{{ key }}</mat-label>
                      <input matInput [(ngModel)]="edits[key]" [name]="key"></mat-form-field>
                  }
                </div>
              }
              <mat-form-field appearance="outline" class="wide"><mat-label>理由</mat-label><input matInput [(ngModel)]="editReason" name="editReason"></mat-form-field>
              <div class="action-buttons">
                <button mat-flat-button color="primary" (click)="saveCorrection()" [disabled]="processing()">保存する</button>
                <button mat-button (click)="discardCorrection()" [disabled]="processing()">取り下げる</button>
              </div>
            }
          </mat-card>
        }

        @if (filing()!.cancelledByFilingId || filing()!.correctedByFilingIds.length) {
          <mat-card class="correction-card">
            @if (filing()!.cancelledByFilingId) { <p>この届出は<a [routerLink]="['/filings', filing()!.cancelledByFilingId]" [queryParams]="{ employeeId: employeeId }">取消届</a>で取り消しました。</p> }
            @for (id of filing()!.correctedByFilingIds; track id) { <p>この届出には<a [routerLink]="['/filings', id]" [queryParams]="{ employeeId: employeeId }">訂正届</a>を出しています。</p> }
          </mat-card>
        }

        @if (canCorrect()) {
          <mat-card class="correction-card">
            <h2>提出したあとに誤りが見つかったら</h2>
            <p class="muted">提出した届出は、訂正届で直すか、取消届で取り消します（承認を受けてから提出します）。</p>
            @if (correctionKind()) {
              <mat-form-field appearance="outline" class="wide"><mat-label>{{ correctionKind() === 'correction' ? '訂正の理由' : '取消の理由' }}（必須）</mat-label>
                <input matInput [(ngModel)]="newReason" name="newReason"></mat-form-field>
              <div class="action-buttons">
                <button mat-flat-button color="primary" (click)="createCorrection()" [disabled]="processing() || !newReason.trim()">{{ correctionKind() === 'correction' ? '訂正届を作る' : '取消届を作る' }}</button>
                <button mat-button (click)="correctionKind.set(null)">やめる</button>
              </div>
            } @else {
              <div class="action-buttons">
                <button mat-stroked-button (click)="correctionKind.set('correction')">訂正届を作る</button>
                <button mat-stroked-button (click)="correctionKind.set('cancellation')">取消届を作る</button>
              </div>
            }
          </mat-card>
        }

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
    .correction-card h3 { font-size: 14px; margin: 12px 0 6px; }
    .diff { border-collapse: collapse; font-size: 13px; margin-bottom: 8px; }
    .diff th, .diff td { padding: 4px 10px; border-bottom: 1px solid var(--app-color-border); text-align: left; }
    .diff td.before { color: var(--app-color-text-sub); text-decoration: line-through; }
    .diff td.after { background: #fff59d; font-weight: 500; }
    .edit-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 0 12px; }
    .wide { width: min(100%, 480px); }
    .muted { color: var(--app-color-text-sub); }
    .note { padding: 8px 12px; border-radius: 8px; background: var(--app-status-yours-bg); }
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

  private destroyRef = inject(DestroyRef);
  correctionKind = signal<'correction' | 'cancellation' | null>(null);
  newReason = '';
  edits: Record<string, string> = {};
  editReason = '';

  ngOnInit() {
    // 訂正届から元の届出へ移るときも同じ画面を使うので、URL が変わるたびに読み直す
    const sub = combineLatest([this.route.paramMap, this.route.queryParamMap]).subscribe(([params, query]) => {
      this.filingId = params.get('filingId') ?? '';
      this.employeeId = query.get('employeeId') ?? '';
      this.correctionKind.set(null);
      this.newReason = '';
      this.loadFiling();
    });
    this.destroyRef.onDestroy(() => sub.unsubscribe());
  }

  isCorrection() { const t = this.filing()?.filingType; return t === 'correction' || t === 'cancellation'; }
  editable() { return this.isCorrection() && ['draft', 'rejected'].includes(this.filing()?.workflowStatus) && !this.filing()?.cancelledAt; }
  canCorrect() { const f = this.filing(); return !!f && !this.isCorrection() && f.submitted && !f.cancelledAt; }
  editableKeys() {
    const fd = this.filing()?.formData ?? {};
    return Object.keys(fd).filter(k => fd[k] === null || typeof fd[k] !== 'object');
  }

  async createCorrection() {
    const kind = this.correctionKind();
    if (!kind) return;
    this.processing.set(true);
    try {
      const { data } = await httpsCallable<object, { filingId: string }>(this.functions, 'filingCorrectionCreate')({
        companyId: this.auth.companyId, employeeId: this.employeeId, filingId: this.filingId, kind, reason: this.newReason.trim(),
      });
      this.snackBar.open(kind === 'correction' ? '訂正届を作りました。直す項目を入れて保存してください' : '取消届を作りました。内容を確かめて承認を申請してください', '閉じる', { duration: 6000 });
      await this.router.navigate(['/filings', data.filingId], { queryParams: { employeeId: this.employeeId } });
    } catch (e: any) {
      this.snackBar.open(`エラー: ${e.message}`, '閉じる', { duration: 8000 });
    } finally {
      this.processing.set(false);
    }
  }

  async saveCorrection() {
    const f = this.filing();
    if (!f) return;
    const patch: Record<string, string> = {};
    for (const key of this.editableKeys()) {
      const current = f.formData[key] == null ? '' : String(f.formData[key]);
      if ((this.edits[key] ?? '') !== current) patch[key] = this.edits[key] ?? '';
    }
    this.processing.set(true);
    try {
      await httpsCallable(this.functions, 'filingCorrectionUpdate')({
        companyId: this.auth.companyId, employeeId: this.employeeId, filingId: this.filingId, expectedVersion: f.version,
        action: 'save', ...(f.filingType === 'correction' ? { formData: patch } : {}), reason: this.editReason,
      });
      this.snackBar.open('保存しました', '閉じる', { duration: 3000 });
      await this.loadFiling(true);
    } catch (e: any) {
      this.snackBar.open(`エラー: ${e.message}`, '閉じる', { duration: 8000 });
    } finally {
      this.processing.set(false);
    }
  }

  async discardCorrection() {
    const f = this.filing();
    if (!f) return;
    this.processing.set(true);
    try {
      await httpsCallable(this.functions, 'filingCorrectionUpdate')({
        companyId: this.auth.companyId, employeeId: this.employeeId, filingId: this.filingId, expectedVersion: f.version, action: 'discard',
      });
      this.snackBar.open('取り下げました', '閉じる', { duration: 3000 });
      await this.router.navigate(['/filings', f.originalFilingId], { queryParams: { employeeId: this.employeeId } });
    } catch (e: any) {
      this.snackBar.open(`エラー: ${e.message}`, '閉じる', { duration: 8000 });
    } finally {
      this.processing.set(false);
    }
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
      const correction = d.filingType === 'correction' || d.filingType === 'cancellation';
      const output = correction
        ? await (await import('../templates/official-filing-pdf')).createCorrectionPdf(d.filingType, d.originalFilingType, d.formData ?? {}, d.corrections ?? [], d.reason ?? '', meta)
        : await createOfficialFilingPdf(d.filingType, d.formData ?? {}, meta);
      const form = OFFICIAL_FORMS[correction ? d.originalFilingType : d.filingType];
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
      this.edits = Object.fromEntries(this.editableKeys().map(k => [k, result.data.formData[k] == null ? '' : String(result.data.formData[k])]));
      this.editReason = result.data.reason ?? '';
    } catch {
      this.filing.set(null);
    } finally {
      this.loading.set(false);
    }
  }
}
