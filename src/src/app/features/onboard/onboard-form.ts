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
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatStepperModule } from '@angular/material/stepper';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';

@Component({
  selector: 'app-onboard-form',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatButtonModule, MatIconModule, MatCardModule,
    MatFormFieldModule, MatInputModule, MatSelectModule,
    MatDatepickerModule, MatStepperModule, MatProgressSpinnerModule, MatDividerModule,
  ],
  template: `
    <div class="onboard-container">
      <div class="onboard-header">
        <mat-icon class="logo">business</mat-icon>
        <h1>入社手続き</h1>
        <p class="subtitle">以下の情報を入力してください</p>
      </div>

      <mat-card class="form-card">
        <mat-stepper [linear]="true" #stepper>
          <mat-step label="基本情報">
            <div class="step-content">
              <div class="form-row">
                <mat-form-field appearance="outline">
                  <mat-label>姓</mat-label>
                  <input matInput [(ngModel)]="lastName" required>
                </mat-form-field>
                <mat-form-field appearance="outline">
                  <mat-label>名</mat-label>
                  <input matInput [(ngModel)]="firstName" required>
                </mat-form-field>
              </div>
              <div class="form-row">
                <mat-form-field appearance="outline">
                  <mat-label>姓（カナ）</mat-label>
                  <input matInput [(ngModel)]="lastNameKana" required>
                </mat-form-field>
                <mat-form-field appearance="outline">
                  <mat-label>名（カナ）</mat-label>
                  <input matInput [(ngModel)]="firstNameKana" required>
                </mat-form-field>
              </div>
              <div class="form-row">
                <mat-form-field appearance="outline">
                  <mat-label>生年月日</mat-label>
                  <input matInput [(ngModel)]="birthDate" placeholder="1990-01-01">
                </mat-form-field>
                <mat-form-field appearance="outline">
                  <mat-label>性別</mat-label>
                  <mat-select [(ngModel)]="gender">
                    <mat-option value="male">男性</mat-option>
                    <mat-option value="female">女性</mat-option>
                  </mat-select>
                </mat-form-field>
              </div>
              <div class="step-actions">
                <button mat-flat-button color="primary" matStepperNext
                  [disabled]="!lastName || !firstName">
                  次へ
                </button>
              </div>
            </div>
          </mat-step>

          <mat-step label="連絡先">
            <div class="step-content">
              <mat-form-field appearance="outline" class="full-width">
                <mat-label>メールアドレス</mat-label>
                <input matInput [(ngModel)]="email" type="email">
              </mat-form-field>
              <mat-form-field appearance="outline" class="full-width">
                <mat-label>電話番号</mat-label>
                <input matInput [(ngModel)]="phone" type="tel">
              </mat-form-field>
              <mat-form-field appearance="outline" class="full-width">
                <mat-label>住所</mat-label>
                <input matInput [(ngModel)]="address">
              </mat-form-field>
              <div class="step-actions">
                <button mat-stroked-button matStepperPrevious>戻る</button>
                <button mat-flat-button color="primary" matStepperNext>次へ</button>
              </div>
            </div>
          </mat-step>

          <mat-step label="扶養家族">
            <div class="step-content">
              <p class="hint">扶養家族がいる場合は以下に入力してください。後から追加することもできます。</p>

              @for (dep of dependents; track dep; let i = $index) {
                <mat-card class="dependent-card">
                  <div class="form-row">
                    <mat-form-field appearance="outline">
                      <mat-label>姓</mat-label>
                      <input matInput [(ngModel)]="dep.lastName">
                    </mat-form-field>
                    <mat-form-field appearance="outline">
                      <mat-label>名</mat-label>
                      <input matInput [(ngModel)]="dep.firstName">
                    </mat-form-field>
                    <mat-form-field appearance="outline">
                      <mat-label>続柄</mat-label>
                      <mat-select [(ngModel)]="dep.relationship">
                        <mat-option value="spouse">配偶者</mat-option>
                        <mat-option value="child">子</mat-option>
                        <mat-option value="parent">父母</mat-option>
                        <mat-option value="other">その他</mat-option>
                      </mat-select>
                    </mat-form-field>
                    <button mat-icon-button color="warn" (click)="removeDependent(i)">
                      <mat-icon>delete</mat-icon>
                    </button>
                  </div>
                </mat-card>
              }

              <button mat-stroked-button (click)="addDependent()">
                <mat-icon>add</mat-icon> 扶養家族を追加
              </button>

              <div class="step-actions">
                <button mat-stroked-button matStepperPrevious>戻る</button>
                <button mat-flat-button color="primary" (click)="goToConfirm()">
                  確認画面へ
                </button>
              </div>
            </div>
          </mat-step>
        </mat-stepper>
      </mat-card>
    </div>
  `,
  styles: [`
    .onboard-container { max-width: 720px; margin: 0 auto; padding: 48px 24px; }
    .onboard-header { text-align: center; margin-bottom: 32px; }
    .logo { font-size: 48px; width: 48px; height: 48px; color: #1976d2; }
    .onboard-header h1 { margin: 12px 0 4px; font-size: 28px; font-weight: 500; }
    .subtitle { color: #666; font-size: 14px; margin: 0; }
    .form-card { padding: 24px; }
    .step-content { padding: 24px 0; }
    .form-row { display: flex; gap: 16px; }
    .form-row mat-form-field { flex: 1; }
    .full-width { width: 100%; }
    .step-actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px; }
    .hint { color: #666; font-size: 14px; margin: 0 0 16px; }
    .dependent-card { padding: 16px; margin-bottom: 12px; background: #fafafa; }
  `],
})
export class OnboardFormComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  token = '';
  lastName = '';
  firstName = '';
  lastNameKana = '';
  firstNameKana = '';
  birthDate = '';
  gender = 'male';
  email = '';
  phone = '';
  address = '';
  dependents: { lastName: string; firstName: string; relationship: string }[] = [];

  ngOnInit() {
    this.token = this.route.snapshot.paramMap.get('token') ?? '';
  }

  addDependent() {
    this.dependents.push({ lastName: '', firstName: '', relationship: 'spouse' });
  }

  removeDependent(index: number) {
    this.dependents.splice(index, 1);
  }

  goToConfirm() {
    this.router.navigate(['/onboard', this.token, 'confirm'], {
      state: {
        lastName: this.lastName,
        firstName: this.firstName,
        lastNameKana: this.lastNameKana,
        firstNameKana: this.firstNameKana,
        birthDate: this.birthDate,
        gender: this.gender,
        email: this.email,
        phone: this.phone,
        address: this.address,
        dependents: this.dependents,
      },
    });
  }
}
