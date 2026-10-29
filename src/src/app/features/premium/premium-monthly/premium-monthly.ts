import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatStepper, MatStepperModule } from '@angular/material/stepper';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../../core/services/auth.service';
import { OfficeContextService } from '../../../core/services/office-context.service';

interface PremiumRow {
  employeeId: string;
  employeeName: string;
  employeeNumber: string;
  healthGrade: number;
  pensionGrade: number;
  healthEmployee: number;
  pensionEmployee: number;
  childSupportPaymentEmployee?: number | null;
  childSupportPaymentEmployer?: number | null;
  childSupportContributionEmployer?: number | null;
  totalEmployee: number;
  totalEmployer: number;
  selected: boolean;
  version: number;
  isExempted: boolean;
  isConfirmed: boolean;
  approvalPending: boolean;
}

@Component({
  selector: 'app-premium-monthly',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatTableModule, MatButtonModule, MatIconModule, MatCardModule,
    MatStepperModule, MatCheckboxModule, MatProgressSpinnerModule,
    MatSnackBarModule,
  ],
  template: `
    <div class="page-container">
      <h1>月次保険料計算</h1>
      <label>計算対象月 <input type="month" [ngModel]="yearMonth" (ngModelChange)="changeMonth($event, stepper)" [disabled]="calculating() || submitting()"></label>
      @if (error()) { <p role="alert">{{ error() }}</p> }
      @for (message of failures(); track $index) { <p role="alert">{{ message }}</p> }

      @if (salaryStatus().unconfirmed.length > 0) {
        <div class="salary-warning" role="alert">
          <mat-icon>warning</mat-icon>
          <div>
            <strong>{{ salaryStatus().unconfirmed.length }}名の給与が未承認です</strong>
            <p>保険料計算には給与の承認が必要です。先に給与画面で承認を完了してください。</p>
            <p class="unconfirmed-names">未承認: {{ salaryStatus().unconfirmed.slice(0, 5).join('、') }}@if (salaryStatus().unconfirmed.length > 5) { 他{{ salaryStatus().unconfirmed.length - 5 }}名 }</p>
          </div>
        </div>
      }

      <mat-stepper linear #stepper>
        <mat-step label="対象者選択" [completed]="results().length > 0" [editable]="!calculating() && !submitting()">
          <mat-card>
            @if (loading()) {
              <div class="loading-container">
                <mat-spinner diameter="40"></mat-spinner>
              </div>
            } @else if (error()) {
              <button mat-stroked-button (click)="loadEmployees()">再読み込み</button>
            } @else if (employees().length === 0) {
              <div class="empty-state">
                <mat-icon>people</mat-icon>
                <p>対象従業員がいません</p>
              </div>
            } @else {
              <table mat-table [dataSource]="employees()" class="full-width-table">
                <ng-container matColumnDef="select">
                  <th mat-header-cell *matHeaderCellDef>
                    <mat-checkbox [disabled]="calculating() || submitting()" (change)="toggleAll($event.checked)"
                      [checked]="allSelected()"
                      [indeterminate]="someSelected()">
                    </mat-checkbox>
                  </th>
                  <td mat-cell *matCellDef="let row; let i = index">
                    <mat-checkbox [disabled]="calculating() || submitting()" [checked]="row.selected"
                      (change)="toggleRow(i, $event.checked)">
                    </mat-checkbox>
                  </td>
                </ng-container>

                <ng-container matColumnDef="employeeName">
                  <th mat-header-cell *matHeaderCellDef>従業員</th>
                  <td mat-cell *matCellDef="let row">{{ row.employeeName }} @if (row.isExempted) { <span>（免除）</span> } @if (row.approvalPending) { <span>（申請済み）</span> } @if (row.isConfirmed) { <span>（承認済み）</span> }</td>
                </ng-container>

                <ng-container matColumnDef="healthGrade">
                  <th mat-header-cell *matHeaderCellDef>社員番号</th>
                  <td mat-cell *matCellDef="let row">{{ row.employeeNumber }}</td>
                </ng-container>

                <ng-container matColumnDef="pensionGrade">
                  <th mat-header-cell *matHeaderCellDef>計算対象月</th>
                  <td mat-cell *matCellDef="let row">{{ yearMonth }}</td>
                </ng-container>

                <tr mat-header-row *matHeaderRowDef="step1Columns"></tr>
                <tr mat-row *matRowDef="let row; columns: step1Columns"></tr>
              </table>
            }
            <div class="step-actions">
              <button mat-flat-button color="primary" (click)="calculate(stepper)"
                [disabled]="selectedCount() === 0 || calculating() || submitting() || loading() || !yearMonth">
                計算実行 ({{ selectedCount() }}名)
              </button>
            </div>
          </mat-card>
        </mat-step>

        <mat-step label="計算結果" [completed]="results().length > 0" [editable]="!calculating() && !submitting()">
          <mat-card>
            @if (calculating()) {
              <div class="loading-container">
                <mat-spinner diameter="40"></mat-spinner>
                <p>保険料を計算中...</p>
              </div>
            } @else {
              <table mat-table [dataSource]="results()" class="full-width-table">
                <ng-container matColumnDef="employeeName">
                  <th mat-header-cell *matHeaderCellDef>従業員</th>
                  <td mat-cell *matCellDef="let row">{{ row.employeeName }} @if (row.isExempted) { <span>（免除）</span> } @if (row.approvalPending) { <span>（申請済み）</span> } @if (row.isConfirmed) { <span>（承認済み）</span> }</td>
                </ng-container>

                <ng-container matColumnDef="healthEmployee">
                  <th mat-header-cell *matHeaderCellDef>健保(本人)</th>
                  <td mat-cell *matCellDef="let row" class="text-right">{{ row.healthEmployee | number }}</td>
                </ng-container>

                <ng-container matColumnDef="pensionEmployee">
                  <th mat-header-cell *matHeaderCellDef>厚年(本人)</th>
                  <td mat-cell *matCellDef="let row" class="text-right">{{ row.pensionEmployee | number }}</td>
                </ng-container>

                <ng-container matColumnDef="childSupportPaymentEmployee">
                  <th mat-header-cell *matHeaderCellDef>支援金(本人)</th>
                  <td mat-cell *matCellDef="let row">{{ row.childSupportPaymentEmployee == null ? '未計算' : (row.childSupportPaymentEmployee | number) }}</td>
                </ng-container>
                <ng-container matColumnDef="childSupportPaymentEmployer">
                  <th mat-header-cell *matHeaderCellDef>支援金(会社)</th>
                  <td mat-cell *matCellDef="let row">{{ row.childSupportPaymentEmployer == null ? '未計算' : (row.childSupportPaymentEmployer | number) }}</td>
                </ng-container>
                <ng-container matColumnDef="childSupportContributionEmployer">
                  <th mat-header-cell *matHeaderCellDef>拠出金(会社のみ)</th>
                  <td mat-cell *matCellDef="let row">{{ row.childSupportContributionEmployer == null ? '未登録' : (row.childSupportContributionEmployer | number) }}</td>
                </ng-container>
                <ng-container matColumnDef="totalEmployee">
                  <th mat-header-cell *matHeaderCellDef>本人合計</th>
                  <td mat-cell *matCellDef="let row" class="text-right bold">{{ row.totalEmployee | number }}</td>
                </ng-container>

                <ng-container matColumnDef="totalEmployer">
                  <th mat-header-cell *matHeaderCellDef>事業主合計</th>
                  <td mat-cell *matCellDef="let row" class="text-right">{{ row.totalEmployer | number }}</td>
                </ng-container>

                <tr mat-header-row *matHeaderRowDef="step2Columns"></tr>
                <tr mat-row *matRowDef="let row; columns: step2Columns"></tr>
              </table>
            }
            <div class="step-actions">
              <button mat-stroked-button matStepperPrevious [disabled]="calculating() || submitting()">戻る</button>
              <button mat-flat-button color="primary" matStepperNext
                [disabled]="calculating() || results().length === 0">
                確認して承認申請
              </button>
            </div>
          </mat-card>
        </mat-step>

        <mat-step label="承認申請">
          <mat-card>
            <div class="confirm-summary">
              <h3>承認申請の確認</h3>
              <p>{{ pendingCount() }}名分の月次保険料計算結果を承認申請します。</p>
              <div class="summary-row">
                <span>本人負担合計:</span>
                <strong>{{ totalEmployeeSum() | number }}円</strong>
              </div>
              <div class="summary-row">
                <span>事業主負担合計:</span>
                <strong>{{ totalEmployerSum() | number }}円</strong>
              </div>
            </div>
            <div class="step-actions">
              <button mat-stroked-button matStepperPrevious [disabled]="calculating() || submitting()">戻る</button>
              <button mat-flat-button color="primary" (click)="submitApproval()"
                [disabled]="submitting() || pendingCount() === 0">
                承認申請
              </button>
            </div>
          </mat-card>
        </mat-step>
      </mat-stepper>
    </div>
  `,
  styles: [`
    .page-container { padding: 24px; }
    h1 { margin: 0 0 24px; font-size: 24px; font-weight: 500; }
    .full-width-table { width: 100%; }
    .text-right { text-align: right; }
    .bold { font-weight: 600; }
    .loading-container { display: flex; flex-direction: column; align-items: center; padding: 48px; gap: 16px; }
    .empty-state { text-align: center; padding: 48px; color: #666; }
    .empty-state mat-icon { font-size: 48px; width: 48px; height: 48px; color: #ccc; }
    .step-actions { display: flex; justify-content: flex-end; gap: 12px; padding: 16px 0; }
    .confirm-summary { padding: 24px; }
    .confirm-summary h3 { margin: 0 0 16px; }
    .summary-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
    .salary-warning { display: flex; gap: 12px; padding: 16px; margin-bottom: 16px; background: #fff3e0; border: 1px solid #ffb74d; border-radius: 8px; }
    .salary-warning mat-icon { color: #e65100; margin-top: 2px; }
    .salary-warning strong { color: #e65100; }
    .salary-warning p { margin: 4px 0 0; font-size: 13px; color: #555; }
    .unconfirmed-names { font-size: 12px !important; color: #888 !important; }
  `],
})
export class PremiumMonthlyComponent implements OnInit {
  private route=inject(ActivatedRoute);
  office = inject(OfficeContextService);
  private functions = inject(Functions);
  private snackBar = inject(MatSnackBar);
  private auth = inject(AuthService);

  employees = signal<PremiumRow[]>([]);
  results = signal<PremiumRow[]>([]);
  loading = signal(false);
  calculating = signal(false);
  submitting = signal(false);
  error = signal('');
  failures = signal<string[]>([]);
  salaryStatus = signal<{ total: number; confirmed: number; unconfirmed: string[] }>({ total: 0, confirmed: 0, unconfirmed: [] });
  yearMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  changeMonth(value: string, stepper: MatStepper) {
    this.yearMonth = value;
    this.results.set([]); this.failures.set([]);
    this.salaryStatus.set({ total: 0, confirmed: 0, unconfirmed: [] });
    stepper.reset();
    this.checkSalaryStatus();
  }
  pendingCount() { return this.results().filter(r => !r.approvalPending && !r.isConfirmed).length; }


  step1Columns = ['select', 'employeeName', 'healthGrade', 'pensionGrade'];
  step2Columns = ['employeeName', 'healthEmployee', 'pensionEmployee', 'childSupportPaymentEmployee', 'childSupportPaymentEmployer', 'childSupportContributionEmployer', 'totalEmployee', 'totalEmployer'];

  ngOnInit() {
    const month=this.route.snapshot.queryParamMap.get('yearMonth');if(month&&/^\d{4}-(0[1-9]|1[0-2])$/.test(month))this.yearMonth=month;
    this.loadEmployees();
  }

  async checkSalaryStatus() {
    if (!this.yearMonth) return;
    try {
      const fn = httpsCallable<object, { items: { employeeName: string; isConfirmed: boolean }[]; hasMore: boolean }>(this.functions, 'salaryList');
      const { data } = await fn({ companyId: this.auth.companyId, yearMonth: this.yearMonth, limit: 200 });
      const unconfirmed = data.items.filter(i => !i.isConfirmed).map(i => i.employeeName);
      this.salaryStatus.set({ total: data.items.length, confirmed: data.items.length - unconfirmed.length, unconfirmed });
    } catch { /* ignore — backend will catch anyway */ }
  }

  selectedCount() {
    return this.employees().filter((e) => e.selected).length;
  }

  allSelected() {
    const emps = this.employees();
    return emps.length > 0 && emps.every((e) => e.selected);
  }

  someSelected() {
    const emps = this.employees();
    return emps.some((e) => e.selected) && !emps.every((e) => e.selected);
  }

  toggleAll(checked: boolean) {
    this.results.set([]);
    this.employees.set(this.employees().map((e) => ({ ...e, selected: checked })));
  }

  toggleRow(index: number, checked: boolean) {
    this.results.set([]);
    const emps = [...this.employees()];
    emps[index] = { ...emps[index], selected: checked };
    this.employees.set(emps);
  }

  totalEmployeeSum() {
    return this.results().filter(r => !r.isConfirmed && !r.approvalPending).reduce((sum, r) => sum + r.totalEmployee, 0);
  }

  totalEmployerSum() {
    return this.results().filter(r => !r.isConfirmed && !r.approvalPending).reduce((sum, r) => sum + r.totalEmployer, 0);
  }

  async calculate(stepper: MatStepper) {
    if (this.calculating() || this.submitting() || !/^\d{4}-(0[1-9]|1[0-2])$/.test(this.yearMonth)) return;
    this.calculating.set(true); this.results.set([]); this.failures.set([]);
    const month = this.yearMonth;
    const output: PremiumRow[] = [];
    const failed: string[] = [];
    try {
      const selected = this.employees().filter(e => e.selected);
      for (let index = 0; index < selected.length; index += 3) {
        await Promise.all(selected.slice(index, index + 3).map(async employee => {
        try {
          const input = { companyId: this.auth.companyId, employeeId: employee.employeeId, yearMonth: month };
          const get = httpsCallable<object, { insurance: { version: number; healthGradeNumber: number; pensionGradeNumber: number; healthEmployee: number; pensionEmployee: number; totalEmployee: number; totalEmployer: number; isExempted: boolean; isConfirmed: boolean; approvalPending: boolean } | null }>(this.functions, 'monthlyInsuranceGet');
          let { data } = await get(input);
          if (!data.insurance?.isConfirmed && !data.insurance?.approvalPending) {
            await httpsCallable(this.functions, 'monthlyInsuranceCalculate')(input);
            ({ data } = await get(input));
          }
          if (!data.insurance) throw new Error('計算結果を取得できませんでした');
          const row = data.insurance;
          output.push({ ...employee, ...row, healthGrade: row.healthGradeNumber, pensionGrade: row.pensionGradeNumber });
        } catch (e: any) {
          failed.push(`${employee.employeeName}：${e.message ?? '計算に失敗しました'}`);
        }
        }));
      }
      output.sort((a, b) => selected.findIndex(e => e.employeeId === a.employeeId) - selected.findIndex(e => e.employeeId === b.employeeId));
      this.results.set(output); this.failures.set(failed);
    } finally { this.calculating.set(false); }
    if (output.length) { stepper.selected!.completed = true; stepper.next(); }
  }

  async submitApproval() {
    if (this.submitting() || !this.pendingCount()) return;
    this.submitting.set(true); this.failures.set([]);
    const failed: string[] = [];
    let sent = 0;
    try {
      for (const row of this.results().filter(r => !r.approvalPending && !r.isConfirmed)) {
        try {
          await httpsCallable(this.functions, 'approvalRequestCreate')({
            companyId: this.auth.companyId, employeeId: row.employeeId,
            targetPath: `companies/${this.auth.companyId}/employees/${row.employeeId}/monthlyInsurance/${this.yearMonth}`,
            targetVersion: row.version, requestType: 'monthlyInsurance',
          });
          this.results.update(rows => rows.map(r => r.employeeId === row.employeeId ? { ...r, approvalPending: true } : r));
          sent++;
        } catch (e: any) { failed.push(`${row.employeeName}：${e.message ?? '申請に失敗しました'}`); }
      }
      this.failures.set(failed);
      this.snackBar.open(`${sent}名の承認申請を送信しました${failed.length ? `（失敗${failed.length}名）` : ''}`, '閉じる', { duration: 5000 });
    } finally { this.submitting.set(false); }
  }

  async loadEmployees() {
    if (this.loading()) return;
    this.loading.set(true); this.error.set('');
    try {
      const output: PremiumRow[] = [];
      let lastDocId: string | undefined;
      const fn = httpsCallable<object, { items: { id: string; employeeNumber: string; lastName: string; firstName: string }[]; hasMore: boolean; lastDocId?: string }>(this.functions, 'employeeList');
      do {
        const { data } = await fn({ companyId: this.auth.companyId, ...this.office.params(), limit: 100, ...(lastDocId ? { lastDocId } : {}) });
        output.push(...data.items.map(e => ({ employeeId: e.id, employeeName: `${e.lastName} ${e.firstName}`, employeeNumber: e.employeeNumber, healthGrade: 0, pensionGrade: 0, healthEmployee: 0, pensionEmployee: 0, totalEmployee: 0, totalEmployer: 0, selected: true, version: 0, isExempted: false, isConfirmed: false, approvalPending: false })));
        if (!data.hasMore) break;
        const cursor = data.lastDocId ?? data.items.at(-1)?.id;
        if (!cursor || cursor === lastDocId) throw new Error('従業員一覧の続きを取得できません');
        lastDocId = cursor;
      } while (true);
      this.employees.set(output);
      this.checkSalaryStatus();
    } catch {
      this.employees.set([]);
      this.error.set('対象者を取得できませんでした。接続状況とアクセス権を確認してください。');
    } finally { this.loading.set(false); }
  }
}
