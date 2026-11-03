import { Component, DestroyRef, computed, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { combineLatest } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../../core/services/auth.service';
import { ConfirmService } from '../../../shared/confirm-dialog/confirm-dialog';
import {
  ActionBarComponent, ErrorStateComponent, LoadingStateComponent, PageHeadComponent, StatusBadgeComponent, StatusTone, StepperComponent, StepperItem,
} from '../../../shared/ui';
import type { FilingPrintMeta } from '../templates/official-filing-pdf';
import { FilingSubmissionComponent } from '../submission/filing-submission';
import { FilingAttachmentsComponent } from '../attachments/filing-attachments';

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
  draft: '下書き', pending: '承認待ち', approved: '承認済', rejected: '差戻し', cancelled: '取消',
};
/** 保存原本の一覧の1行 */
interface ArchiveRow { id: string; approvedAt: string | null; approvedByName: string; filingVersion: number; form: { checkedOn: string } | null }

@Component({
  selector: 'app-filing-detail',
  standalone: true,
  imports: [
    CommonModule, MatButtonModule, MatIconModule, MatSnackBarModule, FilingSubmissionComponent, FilingAttachmentsComponent,
    RouterLink, FormsModule, MatFormFieldModule, MatInputModule,
    PageHeadComponent, StepperComponent, ActionBarComponent, StatusBadgeComponent, LoadingStateComponent, ErrorStateComponent,
  ],
  template: `
    <div class="app-page">
      @if (loading()) {
        <app-loading-state message="届出を読み込んでいます…" />
      } @else if (filing(); as f) {
        <app-page-head [heading]="filingTypeLabel(f.filingType)" kicker="届出" [backLink]="isStaff ? '/filings' : '/approvals'" [backLabel]="isStaff ? '届出一覧' : '承認'">
          <ng-container meta>
            <span><b>{{ f.employeeName }}</b></span>
            @if (f.effectiveDate) { <span>届出日 {{ f.effectiveDate }}</span> }
            <span>作成 {{ f.createdAt | date:'yyyy/MM/dd' }}</span>
          </ng-container>
          <ng-container actions>
            <button mat-stroked-button type="button" (click)="printPdf()" [disabled]="processing()"><mat-icon>picture_as_pdf</mat-icon>公式様式のPDF</button>
            @if (isStaff) { <a mat-stroked-button [routerLink]="['/employees', employeeId]">従業員の画面</a> }
          </ng-container>
        </app-page-head>

        <app-stepper [steps]="stepItems()" [current]="currentStep()" label="届出のステップ" (select)="scrollTo($event)" />

        <section class="panel">
          @if (isCorrection()) {
            <div class="section" id="sec-correction">
              <h3>{{ f.filingType === 'correction' ? '訂正届' : '取消届' }}</h3>
              <p>元の届出：<a [routerLink]="['/filings', f.originalFilingId]" [queryParams]="{ employeeId: employeeId }">{{ filingTypeLabel(f.originalFilingType) }}</a>・理由：{{ f.reason }}</p>
              @if (f.filingType === 'correction') {
                @if (!f.corrections.length) { <p class="muted">まだ直した項目はありません。下の記入内容を直して保存してください。</p> }
                @else {
                  <table class="diff">
                    <thead><tr><th>項目</th><th>訂正前</th><th>訂正後</th></tr></thead>
                    <tbody>@for (c of f.corrections; track c.field) { <tr><th>{{ c.field }}</th><td class="before">{{ c.before || '（空欄）' }}</td><td class="after">{{ c.after || '（空欄）' }}</td></tr> }</tbody>
                  </table>
                }
              }
              @if (isStaff) { <p class="note">台帳・等級・被扶養者などの登録は自動では直りません。必要なら<a [routerLink]="['/employees', employeeId]">従業員の画面</a>で直してください。</p> }
              @if (editable()) {
                @if (f.filingType === 'correction') {
                  <div class="edit-grid">
                    @for (key of editableKeys(); track key) {
                      <mat-form-field appearance="outline"><mat-label>{{ key }}</mat-label>
                        <input matInput [(ngModel)]="edits[key]" [name]="key"></mat-form-field>
                    }
                  </div>
                }
                <mat-form-field appearance="outline" class="wide"><mat-label>理由</mat-label><input matInput [(ngModel)]="editReason" name="editReason"></mat-form-field>
                <div class="row-actions">
                  <button mat-stroked-button type="button" (click)="saveCorrection()" [disabled]="processing()">保存する</button>
                  <button mat-button type="button" (click)="discardCorrection()" [disabled]="processing()">取り下げる</button>
                </div>
              }
            </div>
          }

          @if (f.cancelledByFilingId || f.correctedByFilingIds.length) {
            <div class="section">
              @if (f.cancelledByFilingId) { <p class="note">この届出は<a [routerLink]="['/filings', f.cancelledByFilingId]" [queryParams]="{ employeeId: employeeId }">取消届</a>で取り消しました。</p> }
              @for (id of f.correctedByFilingIds; track id) { <p class="note">この届出には<a [routerLink]="['/filings', id]" [queryParams]="{ employeeId: employeeId }">訂正届</a>を出しています。</p> }
            </div>
          }

          <div class="section" id="sec-approval">
            <h3>社内承認</h3>
            <p><app-status-badge [tone]="approvalTone(f.workflowStatus)" [label]="workflowLabel(f.workflowStatus)" /></p>
            @if (f.workflowStatus === 'rejected' && f.lastApproval?.status === 'rejected') {
              <p class="attention">差し戻されました。理由：{{ f.lastApproval.comment || '（理由の記入なし）' }}。内容を直してから、もう一度承認を依頼してください。</p>
            }
            @if (f.workflowStatus === 'pending') { <p class="muted">別の担当者（管理者・承認者）の承認を待っています。承認は<a routerLink="/approvals">承認</a>の画面で行います。</p> }
          </div>

          <div class="section" id="sec-submit">
            <h3>提出</h3>
            <app-filing-submission [target]="{ source: 'employee', parentId: employeeId, filingId: filingId }" (changed)="loadFiling(true)" />
          </div>

          <div class="section">
            <h3>添付書類</h3>
            <app-filing-attachments [target]="{ source: 'employee', parentId: employeeId, filingId: filingId }" />
          </div>

          <div class="section">
            <h3>保存原本</h3>
            @if (!archives().length) { <p class="muted">承認すると、承認した時点の記入内容を保存原本として残します（消せません）。</p> }
            @else {
              <ul class="archives">
                @for (a of archives(); track a.id) {
                  <li>{{ a.approvedAt | date:'yyyy/MM/dd HH:mm' }} {{ a.approvedByName }}が承認（版 {{ a.filingVersion }}・様式 {{ a.form?.checkedOn ?? '—' }}取得）
                    <button mat-button type="button" (click)="archivePdf(a.id)" [disabled]="processing()">このときのPDF</button></li>
                }
              </ul>
            }
          </div>

          @if (f.formData && objectKeys(f.formData).length > 0) {
            <div class="section">
              <details>
                <summary>記入内容を見る</summary>
                <dl class="data-grid">
                  @for (key of objectKeys(f.formData); track key) {
                    @if (!isArrayValue(f.formData[key])) { <div><dt>{{ key }}</dt><dd>{{ formatValue(f.formData[key]) }}</dd></div> }
                  }
                </dl>
              </details>
            </div>
          }

          @if (canCorrect()) {
            <div class="section">
              <h3>提出したあとに誤りが見つかったら</h3>
              <p class="muted">提出した届出は、訂正届で直すか、取消届で取り消します（承認を受けてから提出します）。</p>
              @if (correctionKind()) {
                <mat-form-field appearance="outline" class="wide"><mat-label>{{ correctionKind() === 'correction' ? '訂正の理由' : '取消の理由' }}（必須）</mat-label>
                  <input matInput [(ngModel)]="newReason" name="newReason"></mat-form-field>
                <div class="row-actions">
                  <button mat-stroked-button type="button" (click)="createCorrection()" [disabled]="processing() || !newReason.trim()">{{ correctionKind() === 'correction' ? '訂正届を作る' : '取消届を作る' }}</button>
                  <button mat-button type="button" (click)="correctionKind.set(null)">やめる</button>
                </div>
              } @else {
                <div class="row-actions">
                  <button mat-stroked-button type="button" (click)="correctionKind.set('correction')">訂正届を作る</button>
                  <button mat-stroked-button type="button" (click)="correctionKind.set('cancellation')">取消届を作る</button>
                </div>
              }
            </div>
          }

          @if (isStaff && (f.workflowStatus === 'draft' || f.workflowStatus === 'rejected')) {
            <app-action-bar [info]="f.workflowStatus === 'rejected' ? '差し戻された内容を直したら、もう一度依頼します。' : ''" notice="依頼中は届出を直せません。直すときは差し戻してもらいます。">
              <button mat-flat-button type="button" (click)="requestApproval()" [disabled]="processing()">承認を依頼する<mat-icon iconPositionEnd>arrow_forward</mat-icon></button>
            </app-action-bar>
          }
        </section>
      } @else {
        <app-error-state message="届出を読み込めませんでした" (retry)="loadFiling()" />
      }
    </div>
  `,
  styles: [`
    .panel { padding: 0 var(--app-space-5) var(--app-space-5); border: 1px solid var(--app-color-border); border-radius: var(--app-radius); background: var(--app-color-surface); }
    .section { padding: var(--app-space-4) 0; border-bottom: 1px solid var(--app-color-border); }
    .section:last-of-type { border-bottom: 0; }
    h3 { margin: 0 0 var(--app-space-2); font-size: var(--app-font-xs); font-weight: 700; color: var(--app-color-text-sub); letter-spacing: .04em; }
    p { margin: 0 0 var(--app-space-2); line-height: 1.7; }
    a { color: var(--app-color-link); }
    a[mat-stroked-button] { color: inherit; }
    .muted { color: var(--app-color-text-sub); font-size: var(--app-font-sm); }
    .note { padding: var(--app-space-2) var(--app-space-3); border-radius: var(--app-radius); background: var(--app-status-yours-bg); font-size: var(--app-font-sm); }
    .attention { padding: var(--app-space-2) var(--app-space-3); border-radius: var(--app-radius); background: var(--app-status-attention-bg); color: var(--app-status-attention-fg); font-size: var(--app-font-sm); }
    .row-actions { display: flex; gap: var(--app-space-2); flex-wrap: wrap; }
    .diff { border-collapse: collapse; font-size: var(--app-font-sm); margin-bottom: var(--app-space-2); }
    .diff th, .diff td { padding: 4px 10px; border-bottom: 1px solid var(--app-color-border); text-align: left; }
    .diff td.before { color: var(--app-color-text-sub); text-decoration: line-through; }
    .diff td.after { background: var(--app-status-attention-bg); font-weight: 600; }
    .edit-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 0 12px; }
    .wide { width: min(100%, 480px); }
    .archives { margin: 0; padding-left: 20px; font-size: var(--app-font-sm); }
    summary { cursor: pointer; color: var(--app-color-link); }
    .data-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 6px var(--app-space-4); margin: var(--app-space-3) 0 0; font-size: var(--app-font-sm); }
    .data-grid dt { color: var(--app-color-text-sub); font-size: var(--app-font-xs); }
    .data-grid dd { margin: 0; word-break: break-all; }
  `],

})
export class FilingDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private functions = inject(Functions);
  private snackBar = inject(MatSnackBar);
  private auth = inject(AuthService);
  /** 承認者は承認する前に中身とPDFを確かめるだけ（依頼・訂正・提出・添付は担当者） */
  readonly isStaff = this.auth.hasAnyRole('admin', 'operator');
  private dialog = inject(MatDialog);
  private confirm = inject(ConfirmService);

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
  archives = signal<ArchiveRow[]>([]);
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
  editable() { return this.isStaff && this.isCorrection() && ['draft', 'rejected'].includes(this.filing()?.workflowStatus) && !this.filing()?.cancelledAt; }
  canCorrect() { const f = this.filing(); return this.isStaff && !!f && !this.isCorrection() && f.submitted && !f.cancelledAt; }
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

  /** 作成 → 社内承認 → 提出。押すとその欄へ移る */
  stepItems = computed<StepperItem[]>(() => {
    const f = this.filing();
    if (!f) return [];
    const ws = f.workflowStatus as string;
    return [
      { key: 'correction', label: '作成', state: ws === 'rejected' ? 'attention' : ws === 'draft' ? 'todo' : 'done', note: ws === 'rejected' ? '差し戻し' : ws === 'draft' ? '下書き' : '完了' },
      { key: 'approval', label: '社内承認', state: ws === 'approved' ? 'done' : ws === 'pending' ? 'waiting' : 'todo', note: ws === 'approved' ? '承認済み' : ws === 'pending' ? '承認者待ち' : '—' },
      { key: 'submit', label: '提出', state: f.submitted ? 'done' : 'todo', note: f.submitted ? '提出済み' : ws === 'approved' ? 'あなたの番' : '—' },
    ];
  });
  currentStep = computed(() => this.stepItems().find(s => s.state !== 'done')?.key ?? 'submit');
  approvalTone(ws: string): StatusTone {
    return ws === 'approved' ? 'done' : ws === 'pending' ? 'waiting' : ws === 'rejected' ? 'attention' : ws === 'cancelled' ? 'waiting' : 'yours';
  }
  scrollTo(key: string) {
    document.getElementById(key === 'correction' ? (this.isCorrection() ? 'sec-correction' : 'sec-approval') : `sec-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  workflowLabel(s: string): string { return WORKFLOW_STATUS_LABELS[s] ?? s; }

  async requestApproval() {
    const ok = await this.confirm.ask({
      title: `${this.filingTypeLabel(this.filing()?.filingType)}の承認を依頼する`, message: `${this.filing()?.employeeName ?? ''}さんの届出の承認を、別の担当者（管理者・承認者）に依頼します。`,
      notice: '依頼中は届出を直せません。直すときは差し戻してもらいます。', confirmLabel: '承認を依頼する',
    });
    if (!ok) return;
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
      this.snackBar.open('承認を依頼しました', '閉じる', { duration: 3000 });
      this.loadFiling();
    } catch (e: any) {
      this.snackBar.open(`エラー: ${e.message}`, '閉じる', { duration: 5000 });
    } finally {
      this.processing.set(false);
    }
  }

  /** 承認した時点の内容（保存原本）から PDF を作り直す */
  async archivePdf(archiveId: string) {
    this.processing.set(true);
    try {
      const { data } = await httpsCallable<object, { archive: import('../archive/archive-pdf').FilingArchive | null }>(this.functions, 'filingArchiveGet')({
        companyId: this.auth.companyId, source: 'employee', parentId: this.employeeId, filingId: this.filingId, archiveId,
      });
      if (!data.archive) throw new Error('保存原本が見つかりません');
      const [{ pdfFromArchive }, { OFFICIAL_FORMS }, { OfficialPdfPreviewComponent }] = await Promise.all([
        import('../archive/archive-pdf'), import('../templates/official-filing-pdf'), import('../templates/official-pdf-preview'),
      ]);
      const output = await pdfFromArchive(data.archive);
      const form = OFFICIAL_FORMS[data.archive.formType];
      this.dialog.open(OfficialPdfPreviewComponent, {
        width: '1100px', height: '94vh', maxWidth: '96vw',
        data: { ...output, title: `${form?.title ?? '届出'}（保存原本 ${data.archive.approvedAt?.slice(0, 10) ?? ''}）`,
          filename: `${form?.title ?? '届出'}_保存原本_${(data.archive.approvedAt ?? '').slice(0, 10)}.pdf`,
          sourceUrl: form ? `https://www.nenkin.go.jp/shinsei/kounen/tekiyo/${form.source}` : '', originalUrl: form ? `/filing-forms/${form.file}.pdf` : '' },
      });
    } catch (e: any) {
      this.snackBar.open(`エラー: ${e.message}`, '閉じる', { duration: 6000 });
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
      const companyResult = await httpsCallable<{ companyId: string }, { representativeName: string; laborConsultant?: { name: string; registrationNumber: string } | null }>(this.functions, 'companyGet')({ companyId: this.auth.companyId });
      // 届出を出す事業所（異動の資格喪失届は元の事業所）の所在地・電話などを書く
      const office = d.office;
      if (!office?.name) throw new Error('届出の事業所情報を取得できませんでした。');
      const meta: FilingPrintMeta = {
        companyName: d.companyName,
        officeName: office.name,
        officeNumber: office.officeNumber,
        officeCode: office.officeCode ?? '',
        officeAddress: office.address,
        officePostalCode: office.postalCode ?? '',
        officePhone: office.phone,
        representativeName: companyResult.data.representativeName,
        effectiveDate: d.effectiveDate,
        employeeNumber: d.employeeNumber,
        laborConsultant: (lc => lc ? `${lc.name}${lc.registrationNumber ? `（登録番号 ${lc.registrationNumber}）` : ''}` : '')(companyResult.data.laborConsultant),
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
      void httpsCallable<object, { items: ArchiveRow[] }>(this.functions, 'filingArchiveList')({
        companyId: this.auth.companyId, source: 'employee', parentId: this.employeeId, filingId: this.filingId,
      }).then(r => this.archives.set(r.data.items)).catch(() => this.archives.set([]));
      this.edits = Object.fromEntries(this.editableKeys().map(k => [k, result.data.formData[k] == null ? '' : String(result.data.formData[k])]));
      this.editReason = result.data.reason ?? '';
    } catch {
      this.filing.set(null);
    } finally {
      this.loading.set(false);
    }
  }
}
