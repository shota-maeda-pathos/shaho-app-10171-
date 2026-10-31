import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../../core/services/auth.service';
import { OfficeContextService } from '../../../core/services/office-context.service';

interface CollectionRow {
  employeeId: string;
  employeeName: string;
  totalPremium: number;
  deducted: number|null;
  balance: number|null;
  collectionVersion:number;
  isConfirmed:boolean;
  status: 'collected' | 'partial' | 'uncollected' | 'overpaid' | 'unrecorded';
}

@Component({
  selector: 'app-premium-collection',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatButtonModule, MatIconModule, MatCardModule, MatTableModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatChipsModule,
    MatProgressSpinnerModule, MatSnackBarModule, MatTabsModule,
  ],
  template: `
    <div class="page-container">
      <div class="page-header">
        <h1>徴収実績</h1>
        <div class="header-actions">
          <mat-form-field appearance="outline" class="month-select">
            <mat-label>対象月</mat-label>
            <mat-select [value]="selectedMonth()" (selectionChange)="onMonthChange($event.value)" [disabled]="recording()">
              @for (m of months; track m) {
                <mat-option [value]="m">{{ m }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        </div>
      </div>

      <p>承認済みの保険料と、実際に徴収した額を分けて管理します。未記録は徴収済み・未徴収のどちらとも判定しません。</p>
      @if(error()) {<p role="alert">{{error()}}</p>}
      @if(unknownCount()) {<p>徴収額が未記録の対象者：{{unknownCount()}}名。徴収・残額の集計は記録済みの対象者分です。</p>}
      <div class="summary-cards">
        <mat-card class="summary-card">
          <div class="summary-label">保険料合計</div>
          <div class="summary-value">{{ totalPremium() | number }} 円</div>
        </mat-card>
        <mat-card class="summary-card">
          <div class="summary-label">徴収済</div>
          <div class="summary-value collected">{{ totalDeducted() | number }} 円</div>
        </mat-card>
        <mat-card class="summary-card">
          <div class="summary-label">未徴収</div>
          <div class="summary-value uncollected">{{ totalBalance() | number }} 円</div>
        </mat-card>
      </div>

      <mat-tab-group>
        <mat-tab label="全件">
          <ng-template matTabContent>
            @if (loading()) {
              <div class="loading-container"><mat-spinner diameter="40"></mat-spinner></div>
            } @else {
              <table mat-table [dataSource]="rows()" class="full-width-table">
                <ng-container matColumnDef="employeeName">
                  <th mat-header-cell *matHeaderCellDef>従業員</th>
                  <td mat-cell *matCellDef="let row">{{ row.employeeName }}</td>
                </ng-container>
                <ng-container matColumnDef="totalPremium">
                  <th mat-header-cell *matHeaderCellDef>保険料</th>
                  <td mat-cell *matCellDef="let row" class="text-right">{{ row.totalPremium | number }}</td>
                </ng-container>
                <ng-container matColumnDef="deducted">
                  <th mat-header-cell *matHeaderCellDef>徴収済</th>
                  <td mat-cell *matCellDef="let row" class="text-right">{{ row.deducted===null?'未記録':(row.deducted | number) }}</td>
                </ng-container>
                <ng-container matColumnDef="balance">
                  <th mat-header-cell *matHeaderCellDef>残額</th>
                  <td mat-cell *matCellDef="let row" class="text-right" [class.warn]="row.balance > 0">
                    {{ row.balance===null?'未記録':(row.balance | number) }}
                  </td>
                </ng-container>
                <ng-container matColumnDef="status">
                  <th mat-header-cell *matHeaderCellDef>状態</th>
                  <td mat-cell *matCellDef="let row">
                    <span class="status-chip" [class]="row.status">{{ statusLabel(row.status) }}</span>
                    <button mat-button (click)="record(row)" [disabled]="recording()||!row.isConfirmed">徴収額を記録</button>
                  </td>
                </ng-container>
                <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
                <tr mat-row *matRowDef="let row; columns: displayedColumns"></tr>
              </table>
              @if (rows().length === 0) {
                <div class="empty-state">
                  <mat-icon>account_balance</mat-icon>
                  <p>{{ selectedMonth() }}の徴収データがありません</p>
                </div>
              }
            }
          </ng-template>
        </mat-tab>
        <mat-tab [label]="'要確認 (' + uncollectedCount() + ')'">
          <ng-template matTabContent>
            <table mat-table [dataSource]="uncollectedRows()" class="full-width-table">
              <ng-container matColumnDef="employeeName">
                <th mat-header-cell *matHeaderCellDef>従業員</th>
                <td mat-cell *matCellDef="let row">{{ row.employeeName }}</td>
              </ng-container>
              <ng-container matColumnDef="totalPremium">
                <th mat-header-cell *matHeaderCellDef>保険料</th>
                <td mat-cell *matCellDef="let row" class="text-right">{{ row.totalPremium | number }}</td>
              </ng-container>
              <ng-container matColumnDef="deducted">
                <th mat-header-cell *matHeaderCellDef>徴収済</th>
                <td mat-cell *matCellDef="let row" class="text-right">{{ row.deducted===null?'未記録':(row.deducted | number) }}</td>
              </ng-container>
              <ng-container matColumnDef="balance">
                <th mat-header-cell *matHeaderCellDef>残額</th>
                <td mat-cell *matCellDef="let row" class="text-right warn">{{ row.balance===null?'未記録':(row.balance | number) }}</td>
              </ng-container>
              <ng-container matColumnDef="status">
                <th mat-header-cell *matHeaderCellDef>状態</th>
                <td mat-cell *matCellDef="let row">
                  <span class="status-chip" [class]="row.status">{{ statusLabel(row.status) }}</span>
                  <button mat-button (click)="record(row)" [disabled]="recording()||!row.isConfirmed">徴収額を記録</button>
                </td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: displayedColumns"></tr>
            </table>
          </ng-template>
        </mat-tab>
      </mat-tab-group>
    </div>
  `,
  styles: [`
    .page-container { padding: 24px; }
    .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
    .page-header h1 { margin: 0; font-size: 24px; font-weight: 500; }
    .month-select { width: 160px; }
    .summary-cards { display: flex; gap: 16px; margin-bottom: 24px; }
    .summary-card { flex: 1; padding: 16px; text-align: center; }
    .summary-label { font-size: 12px; color: #666; }
    .summary-value { font-size: 24px; font-weight: 600; margin-top: 4px; }
    .summary-value.collected { color: #2e7d32; }
    .summary-value.uncollected { color: #c62828; }
    .full-width-table { width: 100%; }
    .text-right { text-align: right; }
    .warn { color: #c62828; font-weight: 500; }
    .loading-container { display: flex; justify-content: center; padding: 48px; }
    .empty-state { text-align: center; padding: 48px; color: #666; }
    .empty-state mat-icon { font-size: 48px; width: 48px; height: 48px; color: #ccc; }
    .status-chip { padding: 4px 12px; border-radius: 16px; font-size: 12px; }
    .status-chip.collected { background: #e8f5e9; color: #2e7d32; }
    .status-chip.uncollected { background: #ffebee; color: #c62828; }
    .status-chip.partial { background: #fff3e0; color: #e65100; }
    .status-chip.overpaid { background: var(--app-brand-tint); color: var(--app-brand-strong); }
  `],
})
export class PremiumCollectionComponent implements OnInit {
  private sequence=0;
  private route=inject(ActivatedRoute);
  error=signal('');recording=signal(false);unknownCount=signal(0);
  office = inject(OfficeContextService);
  private functions = inject(Functions);
  private auth = inject(AuthService);

  rows = signal<CollectionRow[]>([]);
  uncollectedRows = signal<CollectionRow[]>([]);
  loading = signal(false);
  selectedMonth = signal(this.getCurrentMonth());

  totalPremium = signal(0);
  totalDeducted = signal(0);
  totalBalance = signal(0);
  uncollectedCount = signal(0);

  displayedColumns = ['employeeName', 'totalPremium', 'deducted', 'balance', 'status'];
  months = this.generateMonths();

  ngOnInit() {
    const month=this.route.snapshot.queryParamMap.get('yearMonth');if(month&&/^\d{4}-(0[1-9]|1[0-2])$/.test(month))this.selectedMonth.set(month);
    this.loadData();
  }

  onMonthChange(month: string) {
    this.selectedMonth.set(month);
    this.loadData();
  }

  statusLabel(status: string): string {
    const labels: Record<string, string> = {
      collected: '徴収済', partial: '一部徴収', uncollected: '未徴収', overpaid: '過徴収', unrecorded:'未記録',
    };
    return labels[status] ?? status;
  }

  private async loadData() {
    const sequence=++this.sequence;
    this.loading.set(true);
    this.error.set('');this.rows.set([]);this.uncollectedRows.set([]);this.uncollectedCount.set(0);this.totalPremium.set(0);this.totalDeducted.set(0);this.totalBalance.set(0);this.unknownCount.set(0);
    try {
      const fn = httpsCallable<any, any>(this.functions, 'collectionSummary');
      const { data } = await fn({
        companyId: this.auth.companyId,
        ...this.office.params(),
        yearMonth: this.selectedMonth(),
      });

      if(sequence!==this.sequence)return;
      const all: CollectionRow[] = (data.rows ?? []).map((r: any) => {
        const premium = r.totalEmployee;
        const deducted = r.collectedAmount??null;
        const balance = deducted===null?null:premium-deducted;
        return {
          employeeId: r.employeeId,
          employeeName: r.employeeName,
          totalPremium: premium,
          deducted,
          balance,
          collectionVersion:r.collectionVersion??0,isConfirmed:r.isConfirmed===true,
          status: deducted===null?'unrecorded' as const:deducted>premium?'overpaid' as const:deducted === premium ? 'collected' as const
            : deducted > 0 ? 'partial' as const
            : 'uncollected' as const,
        };
      });

      this.rows.set(all);
      this.unknownCount.set(all.filter(r=>r.deducted===null).length);
      this.uncollectedRows.set(all.filter((r) => r.status !== 'collected'));
      this.uncollectedCount.set(this.uncollectedRows().length);
      this.totalPremium.set(data.totals?.totalEmployee ?? 0);
      this.totalDeducted.set(all.reduce((s, r) => s + (r.deducted??0), 0));
      this.totalBalance.set(all.reduce((s, r) => s + (r.balance??0), 0));
    } catch (e:any) {
      if(sequence!==this.sequence)return;
      this.rows.set([]);
      this.error.set(e.message??'徴収情報を取得できませんでした');
    } finally {
      if(sequence===this.sequence)this.loading.set(false);
    }
  }

  private getCurrentMonth(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  async record(row:CollectionRow) {
    if(this.recording())return;
    const value=window.prompt('この対象月について、実際に徴収済みの本人負担額の合計を円単位で入力してください。',row.deducted===null?'':String(row.deducted));
    if(value===null)return;
    if(!/^\d+$/.test(value.trim())||!Number.isSafeInteger(Number(value))){this.error.set('0以上の整数を入力してください');return;}
    const note=window.prompt('記録・訂正の理由を入力してください。');if(!note?.trim())return;
    this.recording.set(true);this.office.busy.set(true);this.error.set('');
    try{await httpsCallable(this.functions,'collectionRecord')({companyId:this.auth.companyId,employeeId:row.employeeId,yearMonth:this.selectedMonth(),collectedAmount:Number(value),expectedVersion:row.collectionVersion,note:note.trim()});await this.loadData();}
    catch(e:any){this.error.set(e.message??'徴収額を保存できませんでした');}finally{this.recording.set(false);this.office.busy.set(false);}
  }

  private generateMonths(): string[] {
    const months: string[] = [];
    const now = new Date();
    for (let i = -6; i <= 1; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    return months;
  }
}
