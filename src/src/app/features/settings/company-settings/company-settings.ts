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
  /** 届出を委託している社会保険労務士（委託していなければ空） */
  consultantName: string;
  consultantNumber: string;
}

interface CompanyHistoryItem {
  id: string; changedFields: string[]; before: Record<string, unknown>; after: Record<string, unknown>; changedAt: string | null;
}

const FIELD_LABELS: Record<string, string> = {
  name: '会社名', representativeName: '代表者名', address: '住所', postalCode: '郵便番号', phone: '電話番号', corporateNumber: '法人番号', laborConsultant: '社会保険労務士',
};

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
            @if (seeding()) { <mat-spinner diameter="20" /> } @else { <mat-icon>play_arrow</mat-icon> }
            @if (!seeding()) { セットアップ実行 }
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
          </div>
          <!-- 保険者番号・事業所整理記号・事業所番号は事業所ごとに「事業所管理」で登録する（届出はそちらを使う） -->
          <p class="sub">保険者番号・事業所整理記号・事業所番号は、事業所ごとに「事業所管理」で登録します。</p>
          <mat-form-field appearance="outline" class="domains">
            <mat-label>Google ログインを許可するドメイン</mat-label>
            <input matInput [(ngModel)]="company.allowedGoogleDomains" [readonly]="!editing()" placeholder="example.com, example.co.jp">
            <mat-hint>カンマで区切る。空欄なら、招待された人はどの Google アカウントでもログインできます</mat-hint>
          </mat-form-field>
          <h3 class="consultant">社会保険労務士（届出を委託している場合）</h3>
          <div class="form-grid">
            <mat-form-field appearance="outline">
              <mat-label>氏名</mat-label>
              <input matInput [(ngModel)]="company.consultantName" [readonly]="!editing()" maxlength="100">
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>登録番号</mat-label>
              <input matInput [(ngModel)]="company.consultantNumber" [readonly]="!editing()" maxlength="20">
              <mat-hint>入れると、届出の「社会保険労務士記載欄」に記入します。委託していなければ空欄</mat-hint>
            </mat-form-field>
          </div>
          @if (editing()) {
            <p class="notice">会社名・代表者名・住所・電話番号・法人番号・社会保険労務士を変えると、承認済みでまだ提出していない届出の承認は自動で取り消されます（古い内容のまま提出しないため）。承認し直してください。</p>
          }
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

        <mat-card class="form-card history">
          <h3 class="consultant">変更の履歴</h3>
          @if (history().length) {
            <table>
              <thead><tr><th>日時</th><th>項目</th><th>変更前</th><th>変更後</th></tr></thead>
              <tbody>
                @for (h of history(); track h.id) {
                  @for (f of h.changedFields; track f; let first = $first) {
                    <tr>
                      <td>{{ first ? formatDate(h.changedAt) : '' }}</td>
                      <td>{{ fieldLabel(f) }}</td>
                      <td>{{ valueText(h.before[f]) }}</td>
                      <td>{{ valueText(h.after[f]) }}</td>
                    </tr>
                  }
                }
              </tbody>
            </table>
          } @else {
            <p class="sub">届出に載る項目（会社名・代表者名・住所など）の変更はまだありません。</p>
          }
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
    .consultant { margin: 20px 0 8px; font-size: 15px; font-weight: 500; }
    .setup-card { padding: 48px; text-align: center; }
    .setup-icon { font-size: 64px; width: 64px; height: 64px; color: var(--app-brand-strong); }
    .setup-card h2 { margin: 16px 0 8px; }
    .setup-card p { color: #666; margin-bottom: 24px; }
    .notice { margin: 12px 0 0; padding: 8px 12px; border-radius: 8px; background: var(--app-status-yours-bg); font-size: 13px; }
    .history { margin-top: 16px; }
    .history table { border-collapse: collapse; font-size: 13px; width: 100%; }
    .history th, .history td { padding: 6px 10px; border-bottom: 1px solid var(--app-color-border); text-align: left; vertical-align: top; }
    .history th { color: var(--app-color-text-sub); font-weight: 500; }
    .sub { color: var(--app-color-text-sub); font-size: 13px; }
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
    consultantName: '', consultantNumber: '',
  };

  history = signal<CompanyHistoryItem[]>([]);

  async ngOnInit() {
    await this.loadCompany();
    await this.loadHistory();
  }

  private async loadHistory() {
    try {
      const { data } = await httpsCallable<object, { items: CompanyHistoryItem[] }>(this.functions, 'companyHistoryList')({ companyId: this.auth.companyId });
      this.history.set(data.items);
    } catch {
      // 履歴は見られる役割が限られる（閲覧者など）。見られなくても会社情報は使える
      this.history.set([]);
    }
  }

  fieldLabel(f: string) { return FIELD_LABELS[f] ?? f; }

  valueText(v: unknown): string {
    if (v === null || v === undefined || v === '') return '（空）';
    if (typeof v === 'object') {
      const c = v as { name?: string; registrationNumber?: string };
      return [c.name, c.registrationNumber].filter(Boolean).join(' ');
    }
    return String(v);
  }

  formatDate(iso: string | null) {
    return iso ? new Date(iso).toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' }) : '';
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
        consultantName: data.laborConsultant?.name ?? '',
        consultantNumber: data.laborConsultant?.registrationNumber ?? '',
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
      const { consultantName, consultantNumber, ...company } = this.company;
      if (consultantName.trim() && !consultantNumber.trim()) throw new Error('社会保険労務士の登録番号を入れてください');
      const fn = httpsCallable<any, any>(this.functions, 'companyUpdate');
      await fn({
        companyId: this.auth.companyId,
        expectedVersion: this.version,
        ...company,
        allowedGoogleDomains: this.company.allowedGoogleDomains.split(/[,、\s]+/).map(d => d.trim()).filter(Boolean),
        laborConsultant: consultantName.trim() ? { name: consultantName.trim(), registrationNumber: consultantNumber.trim() } : null,
      });
      this.version++;
      this.editing.set(false);
      this.snackBar.open('会社情報を更新しました', '閉じる', { duration: 3000 });
      // 履歴はトリガーが少し遅れて残すので、間をおいて読み直す
      setTimeout(() => void this.loadHistory(), 3000);
    } catch (e: any) {
      this.snackBar.open(`保存に失敗しました：${e?.message ?? ''}`, '閉じる', { duration: 6000 });
    } finally {
      this.saving.set(false);
    }
  }
}
