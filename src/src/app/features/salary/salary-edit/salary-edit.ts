import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDividerModule } from '@angular/material/divider';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../../core/services/auth.service';
import { ConfirmDialogComponent } from '../../../shared/confirm-dialog/confirm-dialog';

interface AllowanceEntry {
  name: string;
  amount: number;
}

@Component({
  selector: 'app-salary-edit',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatButtonModule, MatIconModule, MatCardModule,
    MatFormFieldModule, MatInputModule, MatSelectModule,
    MatProgressSpinnerModule, MatSnackBarModule, MatDividerModule, MatChipsModule, MatDialogModule,
  ],
  template: `
    <div class="page-container">
      <div class="page-header">
        <button mat-icon-button (click)="goBack()"><mat-icon>arrow_back</mat-icon></button>
        <h1>給与入力 — {{ employeeName() }}</h1>
        <span class="month-badge">{{ selectedMonth() }}</span>
      </div>

      @if (loading()) {
        <div class="loading-container"><mat-spinner diameter="40"></mat-spinner></div>
      } @else {
        <mat-card class="form-card">
          <h2>基本情報</h2>
          <div class="form-row">
            <mat-form-field appearance="outline">
              <mat-label>対象月</mat-label>
              <mat-select [(ngModel)]="yearMonth" (selectionChange)="loadSalary()">
                @for (m of months; track m) {
                  <mat-option [value]="m">{{ m }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>支払基礎日数</mat-label>
              <input matInput type="number" [(ngModel)]="paymentBasisDays" min="0" max="31">
            </mat-form-field>
          </div>

          <mat-divider></mat-divider>
          <h2>基本給</h2>
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>基本給</mat-label>
            <input matInput type="number" [(ngModel)]="baseSalary" min="0">
            <span matSuffix>円</span>
          </mat-form-field>

          <mat-divider></mat-divider>
          <h2>固定手当</h2>
          @for (a of fixedAllowances; track a.name; let i = $index) {
            <div class="allowance-row">
              <mat-form-field appearance="outline">
                <mat-label>手当名</mat-label>
                <input matInput [(ngModel)]="a.name">
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>金額</mat-label>
                <input matInput type="number" [(ngModel)]="a.amount" min="0">
                <span matSuffix>円</span>
              </mat-form-field>
              <button mat-icon-button color="warn" (click)="removeAllowance('fixed', i)">
                <mat-icon>delete</mat-icon>
              </button>
            </div>
          }
          <button mat-stroked-button (click)="addAllowance('fixed')">
            <mat-icon>add</mat-icon> 固定手当を追加
          </button>

          <mat-divider></mat-divider>
          <h2>変動手当</h2>
          @for (a of variableAllowances; track a.name; let i = $index) {
            <div class="allowance-row">
              <mat-form-field appearance="outline">
                <mat-label>手当名</mat-label>
                <input matInput [(ngModel)]="a.name">
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>金額</mat-label>
                <input matInput type="number" [(ngModel)]="a.amount" min="0">
                <span matSuffix>円</span>
              </mat-form-field>
              <button mat-icon-button color="warn" (click)="removeAllowance('variable', i)">
                <mat-icon>delete</mat-icon>
              </button>
            </div>
          }
          <button mat-stroked-button (click)="addAllowance('variable')">
            <mat-icon>add</mat-icon> 変動手当を追加
          </button>

          <mat-divider></mat-divider>
          <h2>現物給与・遡及差額</h2>
          <div class="form-row">
            <mat-form-field appearance="outline">
              <mat-label>現物給与（社宅・食事など）</mat-label>
              <input matInput type="number" [(ngModel)]="inKindAmount" min="0" (ngModelChange)="recalculate()">
              <span matSuffix>円</span>
              <mat-hint>報酬月額には含めます。支給額には含めません</mat-hint>
            </mat-form-field>
          </div>
          <div class="form-row">
            <mat-form-field appearance="outline">
              <mat-label>遡及差額（昇給の差額のうち過去の月の分）</mat-label>
              <input matInput type="number" [(ngModel)]="retroAmount" min="0">
              <span matSuffix>円</span>
              <mat-hint>手当に含めた金額のうちの差額分。等級の判定からは除きます</mat-hint>
            </mat-form-field>
            @if (retroAmount > 0) {
              <mat-form-field appearance="outline">
                <mat-label>差額の対象（開始月）</mat-label>
                <input matInput type="month" [(ngModel)]="retroFrom">
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>差額の対象（終了月）</mat-label>
                <input matInput type="month" [(ngModel)]="retroTo">
              </mat-form-field>
            }
          </div>
          @if (noPay) { <p class="note">この月は無給として記録されています。金額を入れて保存すると、無給の記録は外れます。</p> }
          @if (locked) { <p class="note">承認済み、または確認の依頼中のため変更できません。直すときは承認の画面で差し戻してください。</p> }

          <mat-divider></mat-divider>
          <div class="summary-section">
            <div class="summary-row">
              <span>固定給合計</span>
              <span class="amount">{{ totalFixed() | number }} 円</span>
            </div>
            <div class="summary-row">
              <span>変動給合計</span>
              <span class="amount">{{ totalVariable() | number }} 円</span>
            </div>
            <div class="summary-row total">
              <span>総支給額</span>
              <span class="amount">{{ totalSalary() | number }} 円</span>
            </div>
          </div>

          <div class="form-actions">
            <button mat-stroked-button (click)="goBack()">キャンセル</button>
            <button mat-flat-button color="primary" (click)="save()" [disabled]="saving() || locked">
              {{ isEdit ? '更新' : '登録' }}
            </button>
          </div>
        </mat-card>
      }
    </div>
  `,
  styles: [`
    .note { color: var(--app-color-text-sub); background: var(--app-color-surface-sub); padding: 8px 12px; border-radius: var(--app-radius); }
    .page-container { padding: 24px; }
    .page-header { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
    .page-header h1 { margin: 0; font-size: 24px; font-weight: 500; flex: 1; }
    .month-badge { padding: 4px 12px; border-radius: 16px; background: #e3f2fd; color: #1565c0; font-size: 14px; }
    .form-card { padding: 24px; }
    .form-card h2 { font-size: 16px; font-weight: 500; margin: 16px 0 12px; }
    .form-row { display: flex; gap: 16px; }
    .form-row mat-form-field { flex: 1; }
    .full-width { width: 100%; }
    .allowance-row { display: flex; gap: 12px; align-items: flex-start; }
    .allowance-row mat-form-field { flex: 1; }
    .summary-section { margin: 24px 0; }
    .summary-row { display: flex; justify-content: space-between; padding: 8px 0; font-size: 14px; }
    .summary-row.total { font-size: 18px; font-weight: 600; border-top: 2px solid #1976d2; padding-top: 12px; }
    .amount { font-family: 'Roboto Mono', monospace; }
    .form-actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px; }
    .loading-container { display: flex; justify-content: center; padding: 48px; }
    mat-divider { margin: 16px 0; }
  `],
})
export class SalaryEditComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private functions = inject(Functions);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private auth = inject(AuthService);

  employeeName = signal('');
  selectedMonth = signal('');
  loading = signal(false);
  saving = signal(false);

  yearMonth = '';
  paymentBasisDays = 0;
  baseSalary = 0;
  fixedAllowances: AllowanceEntry[] = [];
  variableAllowances: AllowanceEntry[] = [];

  inKindAmount = 0;
  retroAmount = 0;
  retroFrom = '';
  retroTo = '';
  noPay = false;
  locked = false;
  /** 毎月の処理から開いたときは、保存後にそこへ戻る */
  private returnTo: { officeId: string } | null = null;

  isEdit = false;
  private salaryId = '';
  private expectedVersion = 0;
  private employeeId = '';

  months = this.generateMonths();

  totalFixed = signal(0);
  totalVariable = signal(0);
  totalSalary = signal(0);

  ngOnInit() {
    this.employeeId = this.route.snapshot.paramMap.get('employeeId') ?? '';
    this.yearMonth = this.route.snapshot.queryParamMap.get('yearMonth') ?? this.route.snapshot.queryParamMap.get('month') ?? this.getCurrentMonth();
    this.selectedMonth.set(this.yearMonth);
    const officeId = this.route.snapshot.queryParamMap.get('officeId');
    if (officeId && officeId !== 'all') this.returnTo = { officeId };
    if (!this.months.includes(this.yearMonth)) this.months = [this.yearMonth, ...this.months];
    this.loadSalary();
  }

  addAllowance(type: 'fixed' | 'variable') {
    const entry: AllowanceEntry = { name: '', amount: 0 };
    if (type === 'fixed') this.fixedAllowances.push(entry);
    else this.variableAllowances.push(entry);
  }

  removeAllowance(type: 'fixed' | 'variable', index: number) {
    if (type === 'fixed') this.fixedAllowances.splice(index, 1);
    else this.variableAllowances.splice(index, 1);
    this.recalculate();
  }

  recalculate() {
    const fixed = this.baseSalary + this.fixedAllowances.reduce((s, a) => s + (a.amount || 0), 0);
    const variable = this.variableAllowances.reduce((s, a) => s + (a.amount || 0), 0);
    this.totalFixed.set(fixed);
    this.totalVariable.set(variable);
    this.totalSalary.set(fixed + variable);
  }

  async loadSalary() {
    this.loading.set(true);
    this.selectedMonth.set(this.yearMonth);
    try {
      const fn = httpsCallable<any, any>(this.functions, 'salaryList');
      const result = await fn({ companyId: this.auth.companyId, yearMonth: this.yearMonth, employeeId: this.employeeId });
      const match = (result.data.items ?? [])[0];
      const d = match?.detail;
      this.employeeName.set(match?.employeeName ?? this.employeeId);
      this.isEdit = !!d?.exists;
      this.salaryId = this.yearMonth;
      this.expectedVersion = match?.version ?? 0;
      this.locked = !!match && (match.isConfirmed || match.approvalPending);
      this.baseSalary = match?.baseSalary ?? 0;
      this.paymentBasisDays = d?.paymentBasisDays ?? 0;
      this.fixedAllowances = Object.entries(d?.fixedAllowances ?? {}).map(([name, amount]) => ({ name, amount: amount as number }));
      this.variableAllowances = Object.entries(d?.variableAllowances ?? {}).map(([name, amount]) => ({ name, amount: amount as number }));
      this.inKindAmount = d?.inKindAmount ?? 0;
      this.retroAmount = d?.retroactivePay?.amount ?? 0;
      this.retroFrom = d?.retroactivePay?.fromMonth ?? '';
      this.retroTo = d?.retroactivePay?.toMonth ?? '';
      this.noPay = d?.noPay === true;
      this.recalculate();
    } catch (e: any) {
      this.employeeName.set(this.employeeId);
      this.snackBar.open(`給与を読み込めませんでした：${e.message ?? ''}`, '閉じる', { duration: 5000 });
    } finally {
      this.loading.set(false);
    }
  }

  private extra() {
    const retroactivePay = this.retroAmount > 0
      ? { amount: Number(this.retroAmount), fromMonth: this.retroFrom, toMonth: this.retroTo || this.retroFrom }
      : null;
    return { inKindAmount: Number(this.inKindAmount) || 0, retroactivePay };
  }

  async save() {
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data: { title: '給与データの保存', message: '給与データを保存します。よろしいですか？', confirmLabel: '保存' },
    });
    const confirmed = await ref.afterClosed().toPromise();
    if (!confirmed) return;
    if (this.retroAmount > 0 && (!/^\d{4}-\d{2}$/.test(this.retroFrom) || (this.retroTo && this.retroTo < this.retroFrom))) {
      this.snackBar.open('遡及差額の対象の月（開始月・終了月）を確かめてください', '閉じる', { duration: 5000 });
      return;
    }

    this.saving.set(true);
    try {
      if (this.isEdit) {
        const fn = httpsCallable(this.functions, 'salaryUpdate');
        await fn({
          companyId: this.auth.companyId,
          employeeId: this.employeeId,
          salaryId: this.salaryId,
          expectedVersion: this.expectedVersion,
          paymentBasisDays: this.paymentBasisDays,
          baseSalary: this.baseSalary,
          fixedAllowances: this.toRecord(this.fixedAllowances),
          variableAllowances: this.toRecord(this.variableAllowances),
          ...this.extra(),
        });
      } else {
        const fn = httpsCallable(this.functions, 'salaryCreate');
        await fn({
          companyId: this.auth.companyId,
          employeeId: this.employeeId,
          yearMonth: this.yearMonth,
          paymentBasisDays: this.paymentBasisDays,
          baseSalary: this.baseSalary,
          fixedAllowances: this.toRecord(this.fixedAllowances),
          variableAllowances: this.toRecord(this.variableAllowances),
          ...this.extra(),
        });
      }
      this.snackBar.open('給与を保存しました', '閉じる', { duration: 3000 });
      this.goBack();
    } catch (e: any) {
      this.snackBar.open(`エラー: ${e.message}`, '閉じる', { duration: 5000 });
    } finally {
      this.saving.set(false);
    }
  }

  goBack() {
    if (this.returnTo) this.router.navigate(['/monthly'], { queryParams: { officeId: this.returnTo.officeId, payMonth: this.yearMonth } });
    else this.router.navigate(['/salary']);
  }

  private toRecord(entries: AllowanceEntry[]): Record<string, number> {
    const rec: Record<string, number> = {};
    for (const e of entries) {
      if (e.name) rec[e.name] = e.amount || 0;
    }
    return rec;
  }

  private getCurrentMonth(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  private generateMonths(): string[] {
    const months: string[] = [];
    const now = new Date();
    for (let i = -3; i <= 3; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    return months;
  }
}
