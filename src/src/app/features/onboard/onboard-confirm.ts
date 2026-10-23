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

@Component({
  selector: 'app-onboard-confirm',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule, MatIconModule, MatCardModule,
    MatDividerModule, MatProgressSpinnerModule, MatSnackBarModule,
  ],
  template: `
    <div class="onboard-container">
      <div class="onboard-header">
        <mat-icon class="logo">fact_check</mat-icon>
        <h1>入力内容の確認</h1>
        <p class="subtitle">以下の内容で送信します。間違いがないか確認してください。</p>
      </div>

      @if (data()) {
        <mat-card class="confirm-card">
          <h2>基本情報</h2>
          <div class="confirm-grid">
            <div class="confirm-item">
              <label>氏名</label>
              <span>{{ data()!.lastName }} {{ data()!.firstName }}</span>
            </div>
            <div class="confirm-item">
              <label>フリガナ</label>
              <span>{{ data()!.lastNameKana }} {{ data()!.firstNameKana }}</span>
            </div>
            <div class="confirm-item">
              <label>生年月日</label>
              <span>{{ data()!.birthDate }}</span>
            </div>
            <div class="confirm-item">
              <label>性別</label>
              <span>{{ data()!.gender === 'male' ? '男性' : '女性' }}</span>
            </div>
          </div>

          <mat-divider></mat-divider>

          <h2>連絡先</h2>
          <div class="confirm-grid">
            <div class="confirm-item">
              <label>メールアドレス</label>
              <span>{{ data()!.email }}</span>
            </div>
            <div class="confirm-item">
              <label>電話番号</label>
              <span>{{ data()!.phone }}</span>
            </div>
            <div class="confirm-item full">
              <label>住所</label>
              <span>{{ data()!.address }}</span>
            </div>
          </div>

          @if (data()!.dependents?.length > 0) {
            <mat-divider></mat-divider>
            <h2>扶養家族（{{ data()!.dependents.length }}名）</h2>
            @for (dep of data()!.dependents; track dep; let i = $index) {
              <div class="dependent-row">
                <span class="dep-number">{{ i + 1 }}</span>
                <span>{{ dep.lastName }} {{ dep.firstName }}</span>
                <span class="dep-relationship">{{ relationshipLabel(dep.relationship) }}</span>
              </div>
            }
          }

          <div class="actions">
            <button mat-stroked-button (click)="goBack()">
              <mat-icon>edit</mat-icon> 修正する
            </button>
            <button mat-flat-button color="primary" (click)="submit()" [disabled]="submitting()">
              @if (submitting()) {
                送信中...
              } @else {
                送信する
              }
            </button>
          </div>
        </mat-card>
      }
    </div>
  `,
  styles: [`
    .onboard-container { max-width: 640px; margin: 0 auto; padding: 48px 24px; }
    .onboard-header { text-align: center; margin-bottom: 32px; }
    .logo { font-size: 48px; width: 48px; height: 48px; color: #1976d2; }
    .onboard-header h1 { margin: 12px 0 4px; font-size: 28px; font-weight: 500; }
    .subtitle { color: #666; font-size: 14px; margin: 0; }
    .confirm-card { padding: 32px; }
    h2 { font-size: 16px; font-weight: 500; margin: 24px 0 12px; color: #333; }
    h2:first-of-type { margin-top: 0; }
    .confirm-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .confirm-item { display: flex; flex-direction: column; gap: 4px; }
    .confirm-item label { font-size: 12px; color: #666; }
    .confirm-item span { font-size: 15px; font-weight: 500; }
    .confirm-item.full { grid-column: 1 / -1; }
    .dependent-row { display: flex; align-items: center; gap: 12px; padding: 8px 0; font-size: 14px; }
    .dep-number { width: 24px; height: 24px; border-radius: 50%; background: #e3f2fd; color: #1976d2; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; }
    .dep-relationship { color: #666; font-size: 12px; padding: 2px 8px; background: #f5f5f5; border-radius: 8px; }
    mat-divider { margin: 24px -32px; }
    .actions { display: flex; justify-content: space-between; margin-top: 32px; }
  `],
})
export class OnboardConfirmComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private functions = inject(Functions);
  private snackBar = inject(MatSnackBar);

  data = signal<any>(null);
  submitting = signal(false);
  private token = '';

  ngOnInit() {
    this.token = this.route.snapshot.paramMap.get('token') ?? '';
    const nav = this.router.getCurrentNavigation();
    const state = nav?.extras?.state ?? history.state;
    if (state?.lastName) {
      this.data.set(state);
    } else {
      this.router.navigate(['/onboard', this.token]);
    }
  }

  relationshipLabel(r: string): string {
    const labels: Record<string, string> = { spouse: '配偶者', child: '子', parent: '父母', other: 'その他' };
    return labels[r] ?? r;
  }

  goBack() {
    this.router.navigate(['/onboard', this.token]);
  }

  async submit() {
    this.submitting.set(true);
    try {
      const fn = httpsCallable(this.functions, 'employeeCreate');
      await fn({
        companyId: 'company-001',
        employeeNumber: `ONB-${Date.now()}`,
        ...this.data(),
      });
      this.router.navigate(['/onboard', this.token, 'complete']);
    } catch (e: any) {
      this.snackBar.open(`エラー: ${e.message}`, '閉じる', { duration: 5000 });
    } finally {
      this.submitting.set(false);
    }
  }
}
