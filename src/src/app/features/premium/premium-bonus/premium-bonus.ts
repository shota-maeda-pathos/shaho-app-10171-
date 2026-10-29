import { FormsModule } from '@angular/forms';
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

interface BonusRow {
  employeeId: string;
  employeeName: string;
  employeeNumber: string;
  bonusAmount: number;
  standardBonusAmount: number;
  healthEmployee: number;
  pensionEmployee: number;
  totalEmployee: number;
  totalEmployer: number;
  selected: boolean;
  version: number;
  isExempted: boolean;
  isConfirmed: boolean;
  approvalPending: boolean;
  hasBonusApproved: boolean;
}

@Component({
  selector: 'app-premium-bonus',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatTableModule, MatButtonModule, MatIconModule, MatCardModule,
    MatStepperModule, MatCheckboxModule, MatProgressSpinnerModule,
    MatSnackBarModule,
  ],
  template: `
    <div class="page-container">
      <h1>賞与保険料一括計算</h1>
      <p class="desc">承認済み賞与がある従業員を対象に、賞与保険料を一括で計算・承認申請できます。</p>
      <label>対象年月 <input type="month" [ngModel]="yearMonth" (ngModelChange)="changeMonth($event, stepper)" [disabled]="calculating() || submitting()"></label>
      @if (error()) { <p role="alert">{{ error() }}</p> }
      @for (message of failures(); track $index) { <p role="alert">{{ message }}</p> }

      <mat-stepper linear #stepper>
        <mat-step label="対象者選択" [completed]="results().length > 0" [editable]="!calculating() && !submitting()">
          <mat-card>
            @if (loading()) {
              <div class="loading-container"><mat-spinner diameter="40"></mat-spinner></div>
            } @else if (employees().length === 0) {
              <div class="empty-state">
                <mat-icon>card_giftcard</mat-icon>
                <p>{{ yearMonth }}に承認済み賞与がある従業員がいません</p>
              </div>
            } @else {
              <table mat-table [dataSource]="employees()" class="full-width-table">
                <ng-container matColumnDef="select">
                  <th mat-header-cell *matHeaderCellDef>
                    <mat-checkbox [disabled]="calculating() || submitting()" (change)="toggleAll($event.checked)"
                      [checked]="allSelected()" [indeterminate]="someSelected()">
                    </mat-checkbox>
                  </th>
                  <td mat-cell *matCellDef="let row; let i = index">
                    <mat-checkbox [disabled]="calculating() || submitting() || !row.hasBonusApproved" [checked]="row.selected"
                      (change)="toggleRow(i, $event.checked)">
                    </mat-checkbox>
                  </td>
                </ng-container>

                <ng-container matColumnDef="employeeName">
                  <th mat-header-cell *matHeaderCellDef>従業員</th>
                  <td mat-cell *matCellDef="let row">
                    {{ row.employeeName }}
                    @if (row.isExempted) { <span class="badge exempted">免除</span> }
                    @if (!row.hasBonusApproved) { <span class="badge no-bonus">賞与未承認</span> }
                    @if (row.isConfirmed) { <span class="badge confirmed">承認済み</span> }
                    @if (row.approvalPending) { <span class="badge pending">申請済み</span> }
                  </td>
                </ng-container>

                <ng-container matColumnDef="employeeNumber">
                  <th mat-header-cell *matHeaderCellDef>社員番号</th>
                  <td mat-cell *matCellDef="let row">{{ row.employeeNumber }}</td>
                </ng-container>

                <ng-container matColumnDef="bonusAmount">
                  <th mat-header-cell *matHeaderCellDef>賞与額</th>
                  <td mat-cell *matCellDef="let row" class="text-right">{{ row.bonusAmount | number }}</td>
                </ng-container>

                <tr mat-header-row *matHeaderRowDef="step1Columns"></tr>
                <tr mat-row *matRowDef="let row; columns: step1Columns" [class.disabled-row]="!row.hasBonusApproved"></tr>
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
              <div class="loading-container"><mat-spinner diameter="40"></mat-spinner><p>賞与保険料を計算中...</p></div>
            } @else {
              <table mat-table [dataSource]="results()" class="full-width-table">
                <ng-container matColumnDef="employeeName">
                  <th mat-header-cell *matHeaderCellDef>従業員</th>
                  <td mat-cell *matCellDef="let row">{{ row.employeeName }}</td>
                </ng-container>
                <ng-container matColumnDef="bonusAmount">
                  <th mat-header-cell *matHeaderCellDef>賞与額</th>
                  <td mat-cell *matCellDef="let row" class="text-right">{{ row.bonusAmount | number }}</td>
                </ng-container>
                <ng-container matColumnDef="healthEmployee">
                  <th mat-header-cell *matHeaderCellDef>健保(本人)</th>
                  <td mat-cell *matCellDef="let row" class="text-right">{{ row.healthEmployee | number }}</td>
                </ng-container>
                <ng-container matColumnDef="pensionEmployee">
                  <th mat-header-cell *matHeaderCellDef>厚年(本人)</th>
                  <td mat-cell *matCellDef="let row" class="text-right">{{ row.pensionEmployee | number }}</td>
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
              <button mat-flat-button color="primary" matStepperNext [disabled]="calculating() || results().length === 0">確認して承認申請</button>
            </div>
          </mat-card>
        </mat-step>

        <mat-step label="承認申請">
          <mat-card>
            <div class="confirm-summary">
              <h3>承認申請の確認</h3>
              <p>{{ pendingCount() }}名分の賞与保険料計算結果を承認申請します。</p>
              <div class="summary-row"><span>本人負担合計:</span><strong>{{ totalEmployeeSum() | number }}円</strong></div>
              <div class="summary-row"><span>事業主負担合計:</span><strong>{{ totalEmployerSum() | number }}円</strong></div>
            </div>
            <div class="step-actions">
              <button mat-stroked-button matStepperPrevious [disabled]="calculating() || submitting()">戻る</button>
              <button mat-flat-button color="primary" (click)="submitApproval()" [disabled]="submitting() || pendingCount() === 0">承認申請</button>
            </div>
          </mat-card>
        </mat-step>
      </mat-stepper>
    </div>
  `,
  styles: [`
    .page-container { padding: 24px; }
    h1 { margin: 0 0 8px; font-size: 24px; font-weight: 500; }
    .desc { margin: 0 0 16px; color: #666; font-size: 14px; }
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
    .badge { font-size: 11px; padding: 2px 6px; border-radius: 4px; margin-left: 6px; }
    .badge.exempted { background: #e8f5e9; color: #2e7d32; }
    .badge.no-bonus { background: #fff3e0; color: #e65100; }
    .badge.confirmed { background: #e3f2fd; color: #1565c0; }
    .badge.pending { background: #fce4ec; color: #c62828; }
    .disabled-row { opacity: 0.5; }
  `],
})
export class PremiumBonusComponent implements OnInit {
  private functions = inject(Functions);
  private snackBar = inject(MatSnackBar);
  private auth = inject(AuthService);

  employees = signal<BonusRow[]>([]);
  results = signal<BonusRow[]>([]);
  loading = signal(false);
  calculating = signal(false);
  submitting = signal(false);
  error = signal('');
  failures = signal<string[]>([]);
  yearMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

  step1Columns = ['select', 'employeeName', 'employeeNumber', 'bonusAmount'];
  step2Columns = ['employeeName', 'bonusAmount', 'healthEmployee', 'pensionEmployee', 'totalEmployee', 'totalEmployer'];

  changeMonth(value: string, stepper: MatStepper) {
    this.yearMonth = value;
    this.results.set([]); this.failures.set([]);
    stepper.reset();
    void this.loadEmployees();
  }

  ngOnInit() { void this.loadEmployees(); }

  selectedCount() { return this.employees().filter(e => e.selected).length; }
  allSelected() { const e = this.employees().filter(r => r.hasBonusApproved); return e.length > 0 && e.every(r => r.selected); }
  someSelected() { const e = this.employees().filter(r => r.hasBonusApproved); return e.some(r => r.selected) && !e.every(r => r.selected); }
  pendingCount() { return this.results().filter(r => !r.approvalPending && !r.isConfirmed).length; }
  totalEmployeeSum() { return this.results().filter(r => !r.isConfirmed && !r.approvalPending).reduce((s, r) => s + r.totalEmployee, 0); }
  totalEmployerSum() { return this.results().filter(r => !r.isConfirmed && !r.approvalPending).reduce((s, r) => s + r.totalEmployer, 0); }

  toggleAll(checked: boolean) {
    this.results.set([]);
    this.employees.set(this.employees().map(e => ({ ...e, selected: e.hasBonusApproved ? checked : false })));
  }

  toggleRow(index: number, checked: boolean) {
    this.results.set([]);
    const emps = [...this.employees()];
    emps[index] = { ...emps[index], selected: checked };
    this.employees.set(emps);
  }

  async calculate(stepper: MatStepper) {
    if (this.calculating() || this.submitting()) return;
    this.calculating.set(true); this.results.set([]); this.failures.set([]);
    const output: BonusRow[] = [];
    const failed: string[] = [];
    try {
      const selected = this.employees().filter(e => e.selected);
      for (let i = 0; i < selected.length; i += 3) {
        await Promise.all(selected.slice(i, i + 3).map(async emp => {
          try {
            const input = { companyId: this.auth.companyId, employeeId: emp.employeeId, yearMonth: this.yearMonth };
            await httpsCallable(this.functions, 'bonusInsuranceCalculate')(input);
            const get = httpsCallable<object, { bonus: any; insurance: any }>(this.functions, 'bonusGet');
            const { data } = await get(input);
            const ins = data.insurance;
            if (!ins) throw new Error('計算結果を取得できませんでした');
            output.push({
              ...emp,
              healthEmployee: ins.healthEmployee ?? 0,
              pensionEmployee: ins.pensionEmployee ?? 0,
              totalEmployee: ins.totalEmployee ?? 0,
              totalEmployer: ins.totalEmployer ?? 0,
              version: ins.version ?? 0,
              isConfirmed: ins.isConfirmed ?? false,
              approvalPending: ins.approvalPending ?? false,
              isExempted: ins.isExempted ?? false,
            });
          } catch (e: any) { failed.push(`${emp.employeeName}：${e.message ?? '計算に失敗しました'}`); }
        }));
      }
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
            targetPath: `companies/${this.auth.companyId}/employees/${row.employeeId}/bonusInsurance/${this.yearMonth}`,
            targetVersion: row.version, requestType: 'bonusInsurance',
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
    this.loading.set(true); this.error.set(''); this.employees.set([]);
    try {
      const output: BonusRow[] = [];
      let lastDocId: string | undefined;
      const listFn = httpsCallable<object, { items: { id: string; employeeNumber: string; lastName: string; firstName: string }[]; hasMore: boolean; lastDocId?: string }>(this.functions, 'employeeList');
      do {
        const { data } = await listFn({ companyId: this.auth.companyId, limit: 100, ...(lastDocId ? { lastDocId } : {}) });
        for (const e of data.items) {
          let bonusAmount = 0;
          let standardBonusAmount = 0;
          let hasBonusApproved = false;
          try {
            const { data: bonusData } = await httpsCallable<object, { bonus: any; insurance: any }>(this.functions, 'bonusGet')({
              companyId: this.auth.companyId, employeeId: e.id, yearMonth: this.yearMonth,
            });
            if (bonusData.bonus?.isConfirmed) {
              hasBonusApproved = true;
              bonusAmount = bonusData.bonus.totalAmount ?? 0;
              standardBonusAmount = bonusData.bonus.standardBonusAmount ?? 0;
            }
          } catch { /* no bonus for this month */ }
          output.push({
            employeeId: e.id, employeeName: `${e.lastName} ${e.firstName}`,
            employeeNumber: e.employeeNumber, bonusAmount, standardBonusAmount,
            healthEmployee: 0, pensionEmployee: 0, totalEmployee: 0, totalEmployer: 0,
            selected: hasBonusApproved, version: 0, isExempted: false, isConfirmed: false,
            approvalPending: false, hasBonusApproved,
          });
        }
        if (!data.hasMore) break;
        const cursor = data.lastDocId ?? data.items.at(-1)?.id;
        if (!cursor || cursor === lastDocId) break;
        lastDocId = cursor;
      } while (true);
      this.employees.set(output);
    } catch {
      this.error.set('対象者を取得できませんでした。');
    } finally { this.loading.set(false); }
  }
}
