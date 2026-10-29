import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../core/services/auth.service';
import { OfficeContextService } from '../../core/services/office-context.service';

interface ProcedureRow {
  id: string;
  procedureType: string;
  title: string;
  priority: string;
  status: string;
  statusReason: string;
  employeeId: string | null;
  employeeName: string;
  officeId: string;
  assignedTo: string;
  deadline: string | null;
  effectiveDate: string | null;
  createdAt: string;
  updatedAt: string;
}

const PROCEDURE_TYPE_LABELS: Record<string, string> = {
  acquisition: '入社手続き',
  loss: '退職手続き',
  dependent_change: '扶養異動',
  maternity_leave: '産前産後休業',
  childcare_leave: '育児休業',
  monthly_change: '随時改定',
  annual_review: '算定基礎届',
  bonus_payment: '賞与支払届',
  transfer: '異動手続き',
  age_event: '年齢到達手続き',
};

const STATUS_LABELS: Record<string, string> = {
  draft: '下書き',
  in_progress: '進行中',
  completed: '完了',
  cancelled: '取消',
};

const PRIORITY_LABELS: Record<string, string> = {
  high: '高',
  normal: '通常',
  low: '低',
};

@Component({
  selector: 'app-procedure-list',
  standalone: true,
  imports: [
    CommonModule, RouterLink,
    MatTableModule, MatButtonModule, MatIconModule, MatCardModule,
    MatFormFieldModule, MatSelectModule, MatProgressSpinnerModule,
  ],
  template: `
    <div class="page-container">
      <div class="page-header">
        <h1>手続き管理</h1>
        @if (auth.hasAnyRole('admin','operator')) { <a mat-flat-button routerLink="/procedures/new">手続きを始める</a> }
      </div>

      <div class="filters">
        <mat-form-field appearance="outline">
          <mat-label>状態</mat-label>
          <mat-select [value]="statusFilter()" (selectionChange)="statusFilter.set($event.value); loadProcedures()">
            <mat-option value="">すべて</mat-option>
            <mat-option value="in_progress">進行中</mat-option>
            <mat-option value="completed">完了</mat-option>
            <mat-option value="cancelled">取消</mat-option>
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>種別</mat-label>
          <mat-select [value]="typeFilter()" (selectionChange)="typeFilter.set($event.value); loadProcedures()">
            <mat-option value="">すべて</mat-option>
            <mat-option value="acquisition">入社手続き</mat-option>
            <mat-option value="loss">退職手続き</mat-option>
            <mat-option value="dependent_change">扶養異動</mat-option>
            <mat-option value="monthly_change">随時改定</mat-option>
            <mat-option value="annual_review">算定基礎届</mat-option>
            <mat-option value="bonus_payment">賞与支払届</mat-option>
            <mat-option value="transfer">異動手続き</mat-option>
          </mat-select>
        </mat-form-field>
      </div>

      @if (error()) { <p role="alert">{{error()}}</p><button mat-stroked-button (click)="loadProcedures()">再読み込み</button> }
      @if (loading()) {
        <div class="loading-container">
          <mat-spinner diameter="40"></mat-spinner>
        </div>
      } @else {
        <mat-card>
          <table mat-table [dataSource]="procedures()" class="full-width-table">
            <ng-container matColumnDef="title">
              <th mat-header-cell *matHeaderCellDef>手続き</th>
              <td mat-cell *matCellDef="let row">
                <a class="link" (click)="viewDetail(row)">{{ row.title }}</a>
              </td>
            </ng-container>

            <ng-container matColumnDef="procedureType">
              <th mat-header-cell *matHeaderCellDef>種別</th>
              <td mat-cell *matCellDef="let row">{{ typeLabel(row.procedureType) }}</td>
            </ng-container>

            <ng-container matColumnDef="status">
              <th mat-header-cell *matHeaderCellDef>状態</th>
              <td mat-cell *matCellDef="let row">
                <span class="status-chip" [attr.data-status]="row.status">
                  {{ statusLabel(row.status) }}
                </span>
              </td>
            </ng-container>

            <ng-container matColumnDef="statusReason">
              <th mat-header-cell *matHeaderCellDef>現在の状況・次の作業</th>
              <td mat-cell *matCellDef="let row">
                <span class="reason-text">{{ row.statusReason }}</span>
              </td>
            </ng-container>

            <ng-container matColumnDef="priority">
              <th mat-header-cell *matHeaderCellDef>優先度</th>
              <td mat-cell *matCellDef="let row">
                <span class="priority-chip" [attr.data-priority]="row.priority">
                  {{ priorityLabel(row.priority) }}
                </span>
              </td>
            </ng-container>

            <ng-container matColumnDef="updatedAt">
              <th mat-header-cell *matHeaderCellDef>更新日</th>
              <td mat-cell *matCellDef="let row">{{ row.updatedAt | date:'yyyy/MM/dd' }}</td>
            </ng-container>

            <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
            <tr mat-row *matRowDef="let row; columns: displayedColumns" class="clickable-row" (click)="viewDetail(row)"></tr>
          </table>

          @if (procedures().length === 0) {
            <div class="empty-state">
              <mat-icon>assignment</mat-icon>
              <p>手続きデータがありません</p>
            </div>
          }

          @if (hasMore()) {
            <div class="load-more">
              <button mat-stroked-button (click)="loadMore()">さらに読み込む</button>
            </div>
          }
        </mat-card>
      }
    </div>
  `,
  styles: [`
    .page-container { padding: 24px; }
    .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .page-header h1 { margin: 0; font-size: 24px; font-weight: 500; }
    .filters { display: flex; gap: 16px; margin-bottom: 16px; }
    .filters mat-form-field { width: 160px; }
    .full-width-table { width: 100%; }
    .loading-container { display: flex; justify-content: center; padding: 48px; }
    .empty-state { text-align: center; padding: 48px; color: #666; }
    .empty-state mat-icon { font-size: 48px; width: 48px; height: 48px; color: #ccc; }
    .link { color: #1976d2; cursor: pointer; text-decoration: none; }
    .link:hover { text-decoration: underline; }
    .clickable-row { cursor: pointer; }
    .clickable-row:hover { background: rgba(0, 0, 0, 0.04); }
    .status-chip { padding: 4px 12px; border-radius: 16px; font-size: 12px; background: #f5f5f5; }
    .status-chip[data-status="in_progress"] { background: #e3f2fd; color: #1565c0; }
    .status-chip[data-status="completed"] { background: #e8f5e9; color: #2e7d32; }
    .status-chip[data-status="cancelled"] { background: #f5f5f5; color: #757575; }
    .priority-chip { font-size: 12px; }
    .priority-chip[data-priority="high"] { color: #c62828; font-weight: 500; }
    .priority-chip[data-priority="low"] { color: #757575; }
    .reason-text { font-size: 13px; color: #555; }
    .load-more { text-align: center; padding: 16px; }
  `],
})
export class ProcedureListComponent implements OnInit {
  office = inject(OfficeContextService);
  private functions = inject(Functions);
  private router = inject(Router);
  auth = inject(AuthService);
  private route = inject(ActivatedRoute);
  error = signal('');
  private requestSequence = 0;

  procedures = signal<ProcedureRow[]>([]);
  loading = signal(false);
  hasMore = signal(false);
  statusFilter = signal('');
  typeFilter = signal('');
  private lastDocId = '';

  displayedColumns = ['title', 'procedureType', 'status', 'statusReason', 'priority', 'updatedAt'];

  ngOnInit() {
    this.loadProcedures();
  }

  typeLabel(type: string): string { return PROCEDURE_TYPE_LABELS[type] ?? type; }
  statusLabel(status: string): string { return STATUS_LABELS[status] ?? status; }
  priorityLabel(p: string): string { return PRIORITY_LABELS[p] ?? p; }

  viewDetail(row: ProcedureRow) {
    this.router.navigate(['/procedures', row.id]);
  }

  async loadProcedures() {
    const request = ++this.requestSequence;
    this.loading.set(true);
    this.error.set(''); this.hasMore.set(false);
    this.lastDocId = '';
    try {
      const fn = httpsCallable<any, any>(this.functions, 'procedureList');
      const params: any = { companyId: this.auth.companyId, ...this.office.params(), limit: 50 };
      const employeeId = this.route.snapshot.queryParamMap.get('employeeId');
      if (employeeId) params.employeeId = employeeId;
      if (this.statusFilter()) params.status = this.statusFilter();
      if (this.typeFilter()) params.procedureType = this.typeFilter();
      const { data } = await fn(params);
      if (request !== this.requestSequence) return;
      this.procedures.set(data.items ?? []);
      this.hasMore.set(data.hasMore ?? false);
      if (data.lastDocId) this.lastDocId = data.lastDocId;
    } catch (e:any) {
      if (request === this.requestSequence) { this.procedures.set([]); this.error.set(e.message ?? '手続きを取得できませんでした'); }
    } finally {
      if (request === this.requestSequence) this.loading.set(false);
    }
  }

  async loadMore() {
    if (!this.lastDocId || this.loading()) return;
    const request = this.requestSequence; this.loading.set(true); this.error.set('');
    try {
      const fn = httpsCallable<any, any>(this.functions, 'procedureList');
      const params: any = { companyId: this.auth.companyId, ...this.office.params(), limit: 50, cursor: this.lastDocId };
      const employeeId = this.route.snapshot.queryParamMap.get('employeeId');
      if (employeeId) params.employeeId = employeeId;
      if (this.statusFilter()) params.status = this.statusFilter();
      if (this.typeFilter()) params.procedureType = this.typeFilter();
      const { data } = await fn(params);
      if (request !== this.requestSequence) return;
      this.procedures.update((prev) => [...prev, ...(data.items ?? [])]);
      this.hasMore.set(data.hasMore ?? false);
      if (data.lastDocId) this.lastDocId = data.lastDocId;
    } catch (e:any) { if (request === this.requestSequence) this.error.set(e.message ?? '続きを取得できませんでした'); }
    finally { if (request === this.requestSequence) this.loading.set(false); }
  }
}
