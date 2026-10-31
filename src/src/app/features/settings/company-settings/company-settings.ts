import { Component, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../../core/services/auth.service';

interface CompanyInfo {
  name: string;
  corporateNumber: string;
  representativeName: string;
  address: string;
  phone: string;
  email: string;
  healthInsurerId: string;
  pensionCode: string;
  /** Google ログインを許可するドメイン（画面ではカンマ区切り） */
  allowedGoogleDomains: string;
}

@Component({
  selector: 'app-company-settings',
  standalone: true,
  imports: [
    FormsModule,
    MatCardModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MatIconModule, MatProgressSpinnerModule,
    MatSnackBarModule,
  ],
  template: `
    <div class="section">
      @if (!loading() && !company.name) {
        <mat-card class="setup-card">
          <mat-icon class="setup-icon">rocket_launch</mat-icon>
          <h2>初期セットアップ</h2>
          <p>会社情報・事業所・保険料率のサンプルデータを一括登録します。</p>
          <button mat-flat-button color="primary" (click)="runSetup()" [disabled]="seeding()">
            @if (seeding()) { <mat-spinner diameter="20" /> } @else { <mat-icon>play_arrow</mat-icon> セットアップ実行 }
          </button>
        </mat-card>
      }

      @if (loading()) {
        <div class="loading"><mat-spinner diameter="40"></mat-spinner></div>
      } @else if (company.name) {
        <mat-card class="form-card">
          <div class="form-grid">
            <mat-form-field appearance="outline">
              <mat-label>会社名</mat-label>
              <input matInput [(ngModel)]="company.name" [readonly]="!editing()">
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>法人番号</mat-label>
              <input matInput [(ngModel)]="company.corporateNumber" [readonly]="!editing()">
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>代表者名</mat-label>
              <input matInput [(ngModel)]="company.representativeName" [readonly]="!editing()">
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>住所</mat-label>
              <input matInput [(ngModel)]="company.address" [readonly]="!editing()">
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>電話番号</mat-label>
              <input matInput [(ngModel)]="company.phone" [readonly]="!editing()">
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>メールアドレス</mat-label>
              <input matInput [(ngModel)]="company.email" [readonly]="!editing()">
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>健保記号</mat-label>
              <input matInput [(ngModel)]="company.healthInsurerId" [readonly]="!editing()">
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>年金コード</mat-label>
              <input matInput [(ngModel)]="company.pensionCode" [readonly]="!editing()">
            </mat-form-field>
          </div>
          <mat-form-field appearance="outline" class="domains">
            <mat-label>Google ログインを許可するドメイン</mat-label>
            <input matInput [(ngModel)]="company.allowedGoogleDomains" [readonly]="!editing()" placeholder="example.com, example.co.jp">
            <mat-hint>カンマで区切る。空欄なら、招待された人はどの Google アカウントでもログインできます</mat-hint>
          </mat-form-field>
          <div class="actions">
            @if (editing()) {
              <button mat-flat-button color="primary" (click)="onSave()" [disabled]="saving()">
                @if (saving()) { <mat-spinner diameter="20" /> } @else { 保存 }
              </button>
              <button mat-stroked-button (click)="cancelEdit()">キャンセル</button>
            } @else {
              <button mat-flat-button color="primary" (click)="startEdit()">
                <mat-icon>edit</mat-icon> 編集
              </button>
            }
          </div>
        </mat-card>
      }
    </div>
  `,
  styles: [`
    .section { padding: 24px 0; }
    .form-card { padding: 24px; }
    .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 16px; }
    .loading { display: flex; justify-content: center; padding: 48px; }
    .actions { display: flex; gap: 12px; margin-top: 16px; }
    .domains { width: 100%; margin-top: 8px; }
    .setup-card { padding: 48px; text-align: center; }
    .setup-icon { font-size: 64px; width: 64px; height: 64px; color: var(--app-brand-strong); }
    .setup-card h2 { margin: 16px 0 8px; }
    .setup-card p { color: #666; margin-bottom: 24px; }
  `],
})
export class CompanySettingsComponent implements OnInit {
  private functions = inject(Functions);
  private auth = inject(AuthService);
  private snackBar = inject(MatSnackBar);

  loading = signal(false);
  saving = signal(false);
  editing = signal(false);
  seeding = signal(false);
  private version = 1;
  private backup: CompanyInfo | null = null;

  company: CompanyInfo = {
    name: '', corporateNumber: '', representativeName: '',
    address: '', phone: '', email: '',
    healthInsurerId: '', pensionCode: '', allowedGoogleDomains: '',
  };

  async ngOnInit() {
    await this.loadCompany();
  }

  private async loadCompany() {
    this.loading.set(true);
    try {
      const fn = httpsCallable<any, any>(this.functions, 'companyGet');
      const { data } = await fn({ companyId: this.auth.companyId });
      this.version = data.version ?? 1;
      this.company = {
        name: data.name ?? '',
        corporateNumber: data.corporateNumber ?? '',
        representativeName: data.representativeName ?? '',
        address: data.address ?? '',
        phone: data.phone ?? '',
        email: data.email ?? '',
        healthInsurerId: data.healthInsurerId ?? '',
        pensionCode: data.pensionCode ?? '',
        allowedGoogleDomains: (data.allowedGoogleDomains ?? []).join(', '),
      };
    } catch {
      this.snackBar.open('会社情報の取得に失敗しました', '閉じる', { duration: 3000 });
    } finally {
      this.loading.set(false);
    }
  }

  startEdit() {
    this.backup = { ...this.company };
    this.editing.set(true);
  }

  cancelEdit() {
    if (this.backup) this.company = { ...this.backup };
    this.editing.set(false);
  }

  async runSetup() {
    this.seeding.set(true);
    try {
      const fn = httpsCallable<any, any>(this.functions, 'seedMasterData');
      await fn({ companyId: this.auth.companyId });
      this.snackBar.open('セットアップ完了！ページを再読み込みします...', '閉じる', { duration: 3000 });
      setTimeout(() => window.location.reload(), 1500);
    } catch (e: any) {
      this.snackBar.open(`セットアップ失敗: ${e.message}`, '閉じる', { duration: 5000 });
    } finally {
      this.seeding.set(false);
    }
  }

  async onSave() {
    this.saving.set(true);
    try {
      const fn = httpsCallable<any, any>(this.functions, 'companyUpdate');
      await fn({
        companyId: this.auth.companyId,
        expectedVersion: this.version,
        ...this.company,
        allowedGoogleDomains: this.company.allowedGoogleDomains.split(/[,、\s]+/).map(d => d.trim()).filter(Boolean),
      });
      this.version++;
      this.editing.set(false);
      this.snackBar.open('会社情報を更新しました', '閉じる', { duration: 3000 });
    } catch (e: any) {
      this.snackBar.open(`保存に失敗しました：${e?.message ?? ''}`, '閉じる', { duration: 6000 });
    } finally {
      this.saving.set(false);
    }
  }
}
