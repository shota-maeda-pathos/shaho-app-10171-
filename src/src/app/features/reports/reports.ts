import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl, SafeUrl } from '@angular/platform-browser';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../core/services/auth.service';
import { OfficeContextService } from '../../core/services/office-context.service';
import { PageHeadComponent } from '../../shared/ui';
import { ReportTable, createReportPdf, reportCsv } from './report-pdf';

import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
type Kind = 'employeePremium' | 'officeMonthly' | 'gradeList' | 'filingStatus' | 'dependents';

const KINDS: { kind: Kind; label: string; note: string; needs: ('month' | 'employee' | 'year')[] }[] = [
  { kind: 'officeMonthly', label: '事業所別月次保険料一覧表', note: '月ごとの確定した保険料（本人・会社の負担、合計つき）', needs: ['month'] },
  { kind: 'employeePremium', label: '従業員別保険料明細書', note: '1人の年度の保険料（月ごと・年度合計）', needs: ['employee', 'month'] },
  { kind: 'gradeList', label: '等級一覧表', note: '在籍している人の今の等級', needs: ['month'] },
  { kind: 'filingStatus', label: '届出提出状況一覧', note: '届出の状態・期限・提出日・受付番号', needs: ['year'] },
  { kind: 'dependents', label: '被扶養者一覧', note: '在籍している人の扶養家族', needs: [] },
];

/** 届出以外の帳票5種（カタログ9章）。PDF（A4・出力日時・ページ番号）と CSV。出力は監査ログに残る */
@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [MatFormFieldModule, MatInputModule, MatSelectModule, FormsModule, MatButtonModule, PageHeadComponent],
  template: `
    <app-page-head heading="帳票"><span meta>{{ office.label() }}が対象です（上の事業所の切り替えで絞れます）。</span></app-page-head>
    @if (departments().length) {
      <p class="form"><mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>部署で絞る（事業所別月次一覧・等級一覧・被扶養者一覧）</mat-label><mat-select [(ngModel)]="departmentId" name="departmentId">
          <mat-option value="">すべての部署</mat-option>
          @for (d of departments(); track d.id) { <mat-option [value]="d.id">{{ d.name }}</mat-option> }
        </mat-select></mat-form-field></p>
    }
    @for (k of kinds; track k.kind) {
      <section class="card">
        <div class="head"><h2>{{ k.label }}</h2><span class="sub">{{ k.note }}</span></div>
        <div class="form">
          @if (k.needs.includes('employee')) { <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>従業員ID</mat-label><input matInput [(ngModel)]="employeeId" [name]="'e' + k.kind" placeholder="例：sample-bonus-0003"></mat-form-field> }
          @if (k.needs.includes('month')) { <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>{{ k.kind === 'employeePremium' ? '年度に含まれる月' : '月' }}</mat-label><input matInput type="month" [(ngModel)]="yearMonth" [name]="'m' + k.kind"></mat-form-field> }
          @if (k.needs.includes('year')) { <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>作成した年</mat-label><input matInput type="number" min="2000" max="2100" [(ngModel)]="year" [name]="'y' + k.kind"></mat-form-field> }
          <button mat-flat-button color="primary" type="button" (click)="output(k.kind, 'pdf')" [disabled]="busy()">PDF</button>
          <button mat-stroked-button type="button" (click)="output(k.kind, 'csv')" [disabled]="busy()">CSV</button>
        </div>
      </section>
    }
    @if (busy()) { <p class="sub">作っています…（PDF は日本語フォントを読み込むため少し時間がかかります）</p> }
    @if (preview(); as p) {
      <section class="card preview">
        <div class="head"><h2>{{ p.title }}</h2><a [href]="p.raw" [download]="p.title + '.pdf'">PDFを保存</a><button mat-button type="button" (click)="closePreview()">閉じる</button></div>
        <iframe [src]="p.url" title="帳票のプレビュー"></iframe>
      </section>
    }
  `,
  styles: [`
    :host { display: block; padding: var(--app-space-5); max-width: 960px; }
    .card { background: var(--app-color-surface); border: 1px solid var(--app-color-border); border-radius: var(--app-radius); padding: 14px 16px; margin-bottom: 10px; }
    .head { display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; }
    h2 { margin: 0; font-size: var(--app-font-md); }
    .form { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; margin-top: 8px; }
    .form label { display: flex; flex-direction: column; gap: 2px; font-size: var(--app-font-sm); color: var(--app-color-text-sub); }
    .form input { padding: 6px 8px; font: inherit; border: 1px solid var(--app-color-border); border-radius: 6px; }
    .sub { color: var(--app-color-text-sub); font-size: var(--app-font-sm); }
    .preview iframe { width: 100%; height: 75vh; border: 1px solid var(--app-color-border); margin-top: 8px; }
    .preview .head a { margin-left: auto; color: var(--app-color-link); }
  `],
})
export class ReportsComponent {
  private functions = inject(Functions);
  private auth = inject(AuthService);
  private snackBar = inject(MatSnackBar);
  office = inject(OfficeContextService);

  kinds = KINDS;
  yearMonth = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }).slice(0, 7);
  year = Number(this.yearMonth.slice(0, 4));
  employeeId = '';
  departmentId = '';
  departments = signal<{ id: string; name: string }[]>([]);
  busy = signal(false);

  constructor() {
    // 部署で絞る選択肢（部署がなければ出さない）
    httpsCallable<object, { items: { id: string; name: string }[] }>(this.functions, 'departmentList')({ companyId: this.auth.companyId, ...this.office.params() })
      .then(r => this.departments.set(r.data.items)).catch(() => this.departments.set([]));
  }
  private sanitizer = inject(DomSanitizer);
  preview = signal<{ title: string; raw: SafeUrl; url: SafeResourceUrl; objectUrl: string } | null>(null);

  closePreview() {
    const p = this.preview();
    if (p) URL.revokeObjectURL(p.objectUrl);
    this.preview.set(null);
  }

  async output(kind: Kind, format: 'pdf' | 'csv') {
    this.busy.set(true);
    try {
      const { data } = await httpsCallable<object, ReportTable>(this.functions, 'reportData', { timeout: 120_000 })({
        companyId: this.auth.companyId, kind, format, ...this.office.params(),
        ...(kind === 'filingStatus' ? { yearMonth: `${this.year}-01` } : kind === 'dependents' ? {} : { yearMonth: this.yearMonth }),
        ...(kind === 'employeePremium' ? { employeeId: this.employeeId.trim() } : {}),
        ...(this.departmentId && ['officeMonthly', 'gradeList', 'dependents'].includes(kind) ? { departmentId: this.departmentId } : {}),
      });
      if (!data.rows.length) this.snackBar.open('当てはまるデータがありません（空の帳票を出します）', '閉じる', { duration: 4000 });
      const blob = format === 'pdf'
        ? new Blob([await createReportPdf(data) as BlobPart], { type: 'application/pdf' })
        : new Blob([reportCsv(data)], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      if (format === 'pdf') {
        // サーバーを待ったあとに新しい窓を開くとブラウザーに止められるので、画面の中でプレビューする
        this.closePreview();
        this.preview.set({ title: data.title, raw: this.sanitizer.bypassSecurityTrustUrl(url), url: this.sanitizer.bypassSecurityTrustResourceUrl(url), objectUrl: url });
      } else {
        const a = document.createElement('a'); a.href = url; a.download = `${data.title}.csv`; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    } catch (e: any) {
      this.snackBar.open(`作れませんでした：${e?.message ?? ''}`, '閉じる', { duration: 6000 });
    } finally {
      this.busy.set(false);
    }
  }
}
