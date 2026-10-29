import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../../core/services/auth.service';
import {
  defaultSanteiYear, INSURED_CATEGORY_LABELS, SANTEI_STATUS_LABELS, SanteiPreviewResponse, SanteiRow, SanteiSubmitResult,
} from '../santei.types';

@Component({
  selector: 'app-santei-detail',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule, MatIconModule, MatCardModule,
    MatDividerModule, MatProgressSpinnerModule, MatSnackBarModule,
  ],
  template: `
    <div class="page-container">
      <div class="page-header">
        <button mat-icon-button (click)="goBack()" aria-label="算定基礎届の一覧に戻る"><mat-icon>arrow_back</mat-icon></button>
        <h1>算定基礎届 — {{ row()?.employeeName ?? '' }}（{{ year }}年）</h1>
      </div>

      @if (loading()) {
        <div class="loading-container"><mat-spinner diameter="40"></mat-spinner></div>
      } @else if (error()) {
        <p role="alert" class="error">{{ error() }}</p>
        <button mat-stroked-button (click)="load()">再読み込み</button>
      } @else if (row(); as r) {
        <p class="guide">
          被保険者の区分：{{ categoryLabel(r.insuredCategory) }}。支払基礎日数が基準に満たない月は平均に含めません。
        </p>

        <div class="month-cards">
          @for (m of r.months; track m.yearMonth) {
            <mat-card [class.excluded]="!m.used">
              <h2>{{ +m.yearMonth.slice(5) }}月</h2>
              <div class="detail-row"><span class="label">支払基礎日数</span><span>{{ m.paymentBasisDays === null ? '—' : m.paymentBasisDays + ' 日' }}</span></div>
              <div class="detail-row total"><span class="label">報酬月額</span><span>{{ m.remuneration === null ? '未登録' : (m.remuneration | number) + ' 円' }}</span></div>
              @if (!m.used && m.remuneration !== null) {
                <div class="excluded-badge"><mat-icon>info</mat-icon>日数が基準に満たないため平均に含めません</div>
              }
            </mat-card>
          }
        </div>

        <mat-card class="result-card">
          <h2>算定結果</h2>
          <div class="status-line">
            <span class="status-chip" [attr.data-status]="r.status">{{ statusLabel(r.status) }}</span>
            <span>{{ r.reason }}</span>
          </div>
          <div class="result-grid">
            <div class="result-item"><label>平均（円未満切捨て）</label><span class="large">{{ r.average === null ? '—' : (r.average | number) + ' 円' }}</span></div>
            <div class="result-item"><label>健康保険</label>
              <span>{{ r.current?.healthGradeNumber ?? '—' }}等級 → <strong [class.changed]="r.changed">{{ r.proposed?.healthGradeNumber ?? '—' }}等級</strong></span>
              <span class="sub">{{ (r.proposed?.healthStandardRemuneration ?? null) === null ? '' : (r.proposed!.healthStandardRemuneration | number) + ' 円' }}</span>
            </div>
            <div class="result-item"><label>厚生年金</label>
              <span>{{ r.current?.pensionGradeNumber ?? '—' }}等級 → <strong [class.changed]="r.changed">{{ r.proposed?.pensionGradeNumber ?? '—' }}等級</strong></span>
              <span class="sub">{{ (r.proposed?.pensionStandardRemuneration ?? null) === null ? '' : (r.proposed!.pensionStandardRemuneration | number) + ' 円' }}</span>
            </div>
          </div>

          @if (r.status === 'ok') {
            <div class="change-notice"><mat-icon>info</mat-icon>
              承認されると、{{ year }}年9月分の保険料から{{ r.changed ? '新しい等級' : '同じ等級（定時決定）' }}が適用されます。
            </div>
          }

          <mat-divider></mat-divider>
          <div class="actions">
            @if (r.approvalStatus !== 'none') {
              <span>{{ r.approvalStatus === 'pending' ? '承認待ちです' : '承認済みです' }}</span>
            } @else if (r.status === 'ok') {
              <button mat-flat-button color="primary" (click)="submit()" [disabled]="submitting()">
                <mat-icon>send</mat-icon> 承認を申請
              </button>
            }
          </div>
        </mat-card>
      }
    </div>
  `,
  styles: [`
    .page-container { padding: 24px; }
    .page-header { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
    .page-header h1 { margin: 0; font-size: 24px; font-weight: 500; }
    .guide { color: #555; margin: 0 0 16px; }
    .loading-container { display: flex; justify-content: center; padding: 48px; }
    .month-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 24px; }
    .month-cards mat-card { padding: 20px; }
    .month-cards mat-card.excluded { opacity: 0.7; border: 1px dashed #e0e0e0; }
    .month-cards h2 { margin: 0 0 12px; font-size: 16px; font-weight: 500; }
    .detail-row { display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 8px; }
    .detail-row.total { font-weight: 600; border-top: 1px solid #e0e0e0; padding-top: 8px; }
    .label { color: #666; }
    .excluded-badge { display: flex; align-items: center; gap: 4px; margin-top: 12px; padding: 8px; background: #fff3e0; border-radius: 8px; font-size: 12px; color: #e65100; }
    .excluded-badge mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .result-card { padding: 24px; }
    .result-card h2 { margin: 0 0 12px; font-size: 18px; font-weight: 500; }
    .status-line { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
    .status-chip { padding: 2px 10px; border-radius: 12px; font-size: 12px; background: #f5f5f5; }
    .status-chip[data-status="ok"] { background: #e8f5e9; color: #2e7d32; }
    .status-chip[data-status="pending"], .status-chip[data-status="needsAction"] { background: #ffebee; color: #c62828; }
    .result-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 24px; }
    .result-item { display: flex; flex-direction: column; gap: 4px; padding: 12px; background: #f5f5f5; border-radius: 8px; }
    .result-item label { font-size: 12px; color: #666; }
    .result-item .large { font-size: 22px; font-weight: 700; }
    .sub { font-size: 12px; color: #666; }
    .changed { color: #e65100; }
    .error { color: #c62828; }
    .change-notice { display: flex; align-items: center; gap: 8px; padding: 12px 16px; background: #e3f2fd; border-radius: 8px; margin-bottom: 24px; font-size: 14px; color: #1565c0; }
    mat-divider { margin: 0 -24px 24px; }
    .actions { display: flex; justify-content: flex-end; align-items: center; gap: 12px; }
    @media (max-width: 768px) {
      .month-cards, .result-grid { grid-template-columns: 1fr; }
    }
  `],
})
export class SanteiDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private functions = inject(Functions);
  private snackBar = inject(MatSnackBar);
  private auth = inject(AuthService);

  employeeId = '';
  year = defaultSanteiYear();
  row = signal<SanteiRow | null>(null);
  loading = signal(false);
  submitting = signal(false);
  error = signal('');

  ngOnInit() {
    this.employeeId = this.route.snapshot.paramMap.get('employeeId') ?? '';
    const year = Number(this.route.snapshot.queryParamMap.get('year'));
    if (Number.isInteger(year) && year > 2000) this.year = year;
    void this.load();
  }

  statusLabel(status: SanteiRow['status']) {
    return SANTEI_STATUS_LABELS[status];
  }

  categoryLabel(category: SanteiRow['insuredCategory']) {
    return INSURED_CATEGORY_LABELS[category];
  }

  goBack() {
    void this.router.navigate(['/santei'], { queryParamsHandling: 'preserve' });
  }

  async load() {
    this.loading.set(true);
    this.error.set('');
    try {
      const { data } = await httpsCallable<object, SanteiPreviewResponse>(this.functions, 'santeiPreview')({
        companyId: this.auth.companyId, year: this.year, employeeIds: [this.employeeId],
      });
      if (!data.items[0]) throw new Error('従業員が見つかりません');
      this.row.set(data.items[0]);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : '算定結果を取得できませんでした');
    } finally {
      this.loading.set(false);
    }
  }

  async submit() {
    this.submitting.set(true);
    try {
      const { data } = await httpsCallable<object, { results: SanteiSubmitResult[] }>(this.functions, 'santeiSubmit')({
        companyId: this.auth.companyId, year: this.year, employeeIds: [this.employeeId],
      });
      const result = data.results[0];
      if (!result?.ok) throw new Error(result?.error ?? '申請できませんでした');
      this.snackBar.open('承認を申請しました。別の担当者の承認後に等級が確定します', '閉じる', { duration: 4000 });
      await this.load();
    } catch (e: unknown) {
      this.snackBar.open(e instanceof Error ? e.message : '申請できませんでした', '閉じる', { duration: 5000 });
    } finally {
      this.submitting.set(false);
    }
  }
}
