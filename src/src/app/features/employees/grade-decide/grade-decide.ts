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
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../../core/services/auth.service';

const DETERMINATION_TYPES: { value: string; label: string }[] = [
  { value: 'initial', label: '資格取得時決定' },
  { value: 'regular', label: '定時決定（算定）' },
  { value: 'occasional', label: '随時改定（月変）' },
  { value: 'specific', label: '特定適用' },
];

@Component({
  selector: 'app-grade-decide',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatButtonModule, MatIconModule, MatCardModule,
    MatFormFieldModule, MatInputModule, MatSelectModule,
    MatProgressSpinnerModule, MatSnackBarModule, MatDividerModule,
  ],
  template: `
    <div class="page-container">
      <div class="page-header">
        <button mat-icon-button (click)="goBack()"><mat-icon>arrow_back</mat-icon></button>
        <h1>等級決定 — {{ employeeName() }}</h1>
      </div>

      @if (loading()) {
        <div class="loading-container"><mat-spinner diameter="40"></mat-spinner></div>
      } @else {
        @if (currentGrade()) {
          <mat-card class="current-card">
            <h2>現在の等級</h2>
            <div class="grade-grid">
              <div class="grade-item">
                <label>適用月</label>
                <span>{{ currentGrade()!.effectiveMonth }}</span>
              </div>
              <div class="grade-item">
                <label>健保 等級</label>
                <span>{{ currentGrade()!.healthGradeNumber }}等級（{{ currentGrade()!.healthStandardRemuneration | number }}円）</span>
              </div>
              <div class="grade-item">
                <label>厚年 等級</label>
                <span>{{ currentGrade()!.pensionGradeNumber }}等級（{{ currentGrade()!.pensionStandardRemuneration | number }}円）</span>
              </div>
              <div class="grade-item">
                <label>決定種別</label>
                <span>{{ determinationLabel(currentGrade()!.determinationType) }}</span>
              </div>
            </div>
          </mat-card>
        }

        <mat-card class="form-card">
          <h2>新しい等級</h2>
          <div class="form-row">
            <mat-form-field appearance="outline">
              <mat-label>適用開始月</mat-label>
              <input matInput [(ngModel)]="effectiveMonth" placeholder="2026-10">
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>決定種別</mat-label>
              <mat-select [(ngModel)]="determinationType">
                @for (t of determinationTypes; track t.value) {
                  <mat-option [value]="t.value">{{ t.label }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
          </div>

          <mat-divider></mat-divider>
          <h3>健康保険</h3>
          <div class="form-row">
            <mat-form-field appearance="outline">
              <mat-label>等級番号</mat-label>
              <input matInput type="number" [(ngModel)]="healthGradeNumber" min="1" max="50">
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>標準報酬月額</mat-label>
              <input matInput type="number" [(ngModel)]="healthStandardRemuneration" min="0">
              <span matSuffix>円</span>
            </mat-form-field>
          </div>

          <h3>厚生年金</h3>
          <div class="form-row">
            <mat-form-field appearance="outline">
              <mat-label>等級番号</mat-label>
              <input matInput type="number" [(ngModel)]="pensionGradeNumber" min="1" max="32">
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>標準報酬月額</mat-label>
              <input matInput type="number" [(ngModel)]="pensionStandardRemuneration" min="0">
              <span matSuffix>円</span>
            </mat-form-field>
          </div>

          <mat-form-field appearance="outline" class="full-width">
            <mat-label>手入力する理由（必須）</mat-label>
            <input matInput [(ngModel)]="reason" required>
            <mat-hint>等級は承認されると確定します。標準報酬月額は等級番号から等級表の金額になります</mat-hint>
          </mat-form-field>

          <div class="form-actions">
            <button mat-stroked-button (click)="goBack()">キャンセル</button>
            <button mat-flat-button color="primary" (click)="save()" [disabled]="saving() || !reason.trim()">
              {{ isEdit ? '訂正の承認を依頼する' : '等級の承認を依頼する' }}
            </button>
          </div>
        </mat-card>
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
    h3 { font-size: 14px; font-weight: 500; margin: 16px 0 8px; }
    .grade-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .grade-item { display: flex; flex-direction: column; gap: 4px; }
    .grade-item label { font-size: 12px; color: #666; }
    .grade-item span { font-size: 14px; font-weight: 500; }
    .current-card { background: #f5f5f5; }
    .form-row { display: flex; gap: 16px; }
    .form-row mat-form-field { flex: 1; }
    .full-width { width: 100%; }
    .form-actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px; }
    mat-divider { margin: 16px 0; }
  `],
})
export class GradeDecideComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private functions = inject(Functions);
  private snackBar = inject(MatSnackBar);
  private auth = inject(AuthService);

  employeeName = signal('');
  currentGrade = signal<any>(null);
  loading = signal(false);
  saving = signal(false);

  effectiveMonth = '';
  determinationType = 'regular';
  healthGradeNumber = 1;
  healthStandardRemuneration = 0;
  pensionGradeNumber = 1;
  pensionStandardRemuneration = 0;
  reason = '';
  isEdit = false;

  determinationTypes = DETERMINATION_TYPES;
  private employeeId = '';
  private gradeId = '';
  private expectedVersion = 0;

  ngOnInit() {
    this.employeeId = this.route.snapshot.paramMap.get('id') ?? '';
    const now = new Date();
    this.effectiveMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    this.loadEmployee();
  }

  determinationLabel(type: string): string {
    return DETERMINATION_TYPES.find((t) => t.value === type)?.label ?? type;
  }

  async save() {
    this.saving.set(true);
    try {
      if (this.isEdit) {
        const fn = httpsCallable(this.functions, 'gradeUpdate');
        await fn({
          companyId: this.auth.companyId,
          employeeId: this.employeeId,
          gradeId: this.gradeId,
          expectedVersion: this.expectedVersion,
          healthGradeNumber: this.healthGradeNumber,
          healthStandardRemuneration: this.healthStandardRemuneration,
          pensionGradeNumber: this.pensionGradeNumber,
          pensionStandardRemuneration: this.pensionStandardRemuneration,
          reason: this.reason,
        });
      } else {
        const fn = httpsCallable(this.functions, 'gradeCreate');
        await fn({
          companyId: this.auth.companyId,
          employeeId: this.employeeId,
          effectiveMonth: this.effectiveMonth,
          determinationType: this.determinationType,
          healthGradeNumber: this.healthGradeNumber,
          healthStandardRemuneration: this.healthStandardRemuneration,
          pensionGradeNumber: this.pensionGradeNumber,
          pensionStandardRemuneration: this.pensionStandardRemuneration,
          reason: this.reason,
        });
      }
      this.snackBar.open('承認を依頼しました。承認されると等級が確定します', '閉じる', { duration: 4000 });
      this.goBack();
    } catch (e: any) {
      this.snackBar.open(`エラー: ${e.message}`, '閉じる', { duration: 5000 });
    } finally {
      this.saving.set(false);
    }
  }

  goBack() {
    this.router.navigate(['/employees', this.employeeId]);
  }

  private async loadEmployee() {
    this.loading.set(true);
    try {
      const fn = httpsCallable<any, any>(this.functions, 'employeeGet');
      const result = await fn({
        companyId: this.auth.companyId,
        employeeId: this.employeeId,
      });
      const emp = result.data;
      this.employeeName.set(`${emp.lastName} ${emp.firstName}`);
    } catch {
      this.employeeName.set(this.employeeId);
    } finally {
      this.loading.set(false);
    }
  }
}
