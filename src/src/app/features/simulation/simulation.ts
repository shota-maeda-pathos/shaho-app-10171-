import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';
import { MatTableModule } from '@angular/material/table';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../core/services/auth.service';

interface Office { id: string; name: string; }
interface SimResult {
  health: { gradeNumber: number; standardRemuneration: number; rate: number; employeeAmount: number; employerAmount: number };
  longTermCare: { gradeNumber: number; standardRemuneration: number; rate: number; employeeAmount: number; employerAmount: number } | null;
  pension: { gradeNumber: number; standardRemuneration: number; rate: number; employeeAmount: number; employerAmount: number } | null;
  childSupport: { rate: number; employerAmount: number };
  totalEmployee: number;
  totalEmployer: number;
  totalCompany: number;
}

@Component({
  selector: 'app-simulation',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatCardModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatDividerModule, MatTableModule,
  ],
  template: `
    <div class="page-container">
      <h2>保険料シミュレーション</h2>
      <p class="subtitle">報酬月額と年齢を入力して、社会保険料の概算を確認できます。</p>

      <mat-card class="sim-form">
        <mat-card-content>
          <div class="form-row">
            <mat-form-field>
              <mat-label>事業所</mat-label>
              <mat-select [(ngModel)]="officeId">
                @for (o of offices(); track o.id) {
                  <mat-option [value]="o.id">{{ o.name }}</mat-option>
                }
              </mat-select>
            </mat-form-field>

            <mat-form-field>
              <mat-label>報酬月額（円）</mat-label>
              <input matInput type="number" [(ngModel)]="monthlyRemuneration" min="0" step="1000">
            </mat-form-field>

            <mat-form-field>
              <mat-label>年齢</mat-label>
              <input matInput type="number" [(ngModel)]="age" min="15" max="80">
            </mat-form-field>

            <button mat-flat-button color="primary" (click)="simulate()" [disabled]="loading()">
              @if (loading()) {
                <mat-spinner diameter="20" />
              } @else {
                <mat-icon>calculate</mat-icon> 計算
              }
            </button>
          </div>
        </mat-card-content>
      </mat-card>

      @if (result()) {
        <mat-card class="result-card">
          <mat-card-header>
            <mat-card-title>シミュレーション結果</mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <table mat-table [dataSource]="resultRows()" class="result-table">
              <ng-container matColumnDef="item">
                <th mat-header-cell *matHeaderCellDef>項目</th>
                <td mat-cell *matCellDef="let row" [class.total-row]="row.isTotal">{{ row.item }}</td>
              </ng-container>
              <ng-container matColumnDef="grade">
                <th mat-header-cell *matHeaderCellDef>等級</th>
                <td mat-cell *matCellDef="let row">{{ row.grade }}</td>
              </ng-container>
              <ng-container matColumnDef="standard">
                <th mat-header-cell *matHeaderCellDef>標準報酬月額</th>
                <td mat-cell *matCellDef="let row">{{ row.standard }}</td>
              </ng-container>
              <ng-container matColumnDef="rate">
                <th mat-header-cell *matHeaderCellDef>料率（‰）</th>
                <td mat-cell *matCellDef="let row">{{ row.rate }}</td>
              </ng-container>
              <ng-container matColumnDef="employee">
                <th mat-header-cell *matHeaderCellDef>被保険者負担</th>
                <td mat-cell *matCellDef="let row" [class.total-row]="row.isTotal">{{ row.employee }}</td>
              </ng-container>
              <ng-container matColumnDef="employer">
                <th mat-header-cell *matHeaderCellDef>事業主負担</th>
                <td mat-cell *matCellDef="let row" [class.total-row]="row.isTotal">{{ row.employer }}</td>
              </ng-container>

              <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: displayedColumns;"></tr>
            </table>
          </mat-card-content>
        </mat-card>
      }
    </div>
  `,
  styles: `
    .page-container { max-width: 900px; }
    .subtitle { color: #666; margin-bottom: 24px; }
    .sim-form { margin-bottom: 24px; }
    .form-row {
      display: flex; gap: 16px; align-items: center; flex-wrap: wrap;
      mat-form-field { flex: 1; min-width: 160px; }
      button { height: 56px; }
    }
    .result-card { margin-top: 16px; }
    .result-table { width: 100%; }
    .total-row { font-weight: 700; }
  `,
})
export class SimulationComponent implements OnInit {
  private functions = inject(Functions);
  auth = inject(AuthService);

  offices = signal<Office[]>([]);
  officeId = '';
  monthlyRemuneration = 300000;
  age = 35;
  loading = signal(false);
  result = signal<SimResult | null>(null);

  displayedColumns = ['item', 'grade', 'standard', 'rate', 'employee', 'employer'];

  ngOnInit() { this.loadOffices(); }

  resultRows() {
    const r = this.result();
    if (!r) return [];
    const fmt = (n: number) => n.toLocaleString() + '円';
    const rows: any[] = [
      { item: '健康保険', grade: r.health.gradeNumber + '等級', standard: fmt(r.health.standardRemuneration), rate: r.health.rate, employee: fmt(r.health.employeeAmount), employer: fmt(r.health.employerAmount) },
    ];
    if (r.longTermCare) {
      rows.push({ item: '介護保険', grade: '', standard: '', rate: r.longTermCare.rate, employee: fmt(r.longTermCare.employeeAmount), employer: fmt(r.longTermCare.employerAmount) });
    }
    if (r.pension) {
      rows.push({ item: '厚生年金', grade: r.pension.gradeNumber + '等級', standard: fmt(r.pension.standardRemuneration), rate: r.pension.rate, employee: fmt(r.pension.employeeAmount), employer: fmt(r.pension.employerAmount) });
    }
    rows.push({ item: '子ども・子育て拠出金', grade: '', standard: '', rate: r.childSupport.rate, employee: '-', employer: fmt(r.childSupport.employerAmount) });
    rows.push({ item: '合計', grade: '', standard: '', rate: '', employee: fmt(r.totalEmployee), employer: fmt(r.totalEmployer), isTotal: true });
    return rows;
  }

  async loadOffices() {
    const fn = httpsCallable(this.functions, 'officeList');
    const res: any = await fn({ companyId: this.auth.companyId });
    this.offices.set(res.data.items ?? []);
    if (this.offices().length > 0) this.officeId = this.offices()[0].id;
  }

  async simulate() {
    if (!this.officeId) return;
    this.loading.set(true);
    try {
      const fn = httpsCallable(this.functions, 'premiumSimulate');
      const res: any = await fn({
        companyId: this.auth.companyId,
        officeId: this.officeId,
        monthlyRemuneration: this.monthlyRemuneration,
        age: this.age,
      });
      this.result.set(res.data);
    } catch (e: any) {
      console.error(e);
    } finally {
      this.loading.set(false);
    }
  }
}
