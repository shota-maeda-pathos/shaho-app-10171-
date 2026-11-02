import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import { ConfirmDialogComponent } from '../../../shared/confirm-dialog/confirm-dialog';
import { TermComponent } from '../../../shared/ui';

import { MatDatepickerModule } from '@angular/material/datepicker';
interface OfficeRow {
  id: string;
  name: string;
  officeNumber: string;
  address: string;
  phone: string;
  closingDay: number;
  paymentDay: number;
  isActive: boolean;
  roundingRule?: RoundingRule;
  /** 賞与の支給予定月（古いサーバーは返さない） */
  bonusMonths?: number[];
  /** 古いサーバーは返さない */
  version?: number;
  prefectureCode?: string;
  insurerId?: string;
  healthInsuranceType?: 'kyokai' | 'union';
  pensionOfficeName?: string | null;
  officeCode?: string | null;
  abolishedOn?: string | null;
  /** 配属できない理由（空なら配属できる）。古いサーバーは返さない */
  setupIssues?: string[];
}

interface OfficeEdit { id: string; version: number; name: string; prefectureCode: string; healthInsuranceType: 'kyokai' | 'union'; insurerId: string; pensionOfficeName: string; officeCode: string; abolishedOn: string }

type RoundingRule = 'statutory' | 'truncate' | 'round' | 'ceil';

const ROUNDING_LABELS: Record<RoundingRule, string> = {
  statutory: '法定（50銭以下切捨て・50銭超切上げ）',
  truncate: '切捨て（労使の取り決めがある場合）',
  round: '四捨五入（労使の取り決めがある場合）',
  ceil: '切上げ（労使の取り決めがある場合）',
};

interface MigrationResult {
  dryRun: boolean;
  offices: { id: string; name: string; from: string | null }[];
}

const PREFECTURES: Record<string, string> = {
  '01': '北海道', '02': '青森', '03': '岩手', '04': '宮城', '05': '秋田',
  '06': '山形', '07': '福島', '08': '茨城', '09': '栃木', '10': '群馬',
  '11': '埼玉', '12': '千葉', '13': '東京', '14': '神奈川', '15': '新潟',
  '23': '愛知', '26': '京都', '27': '大阪', '28': '兵庫', '40': '福岡',
};

@Component({
  selector: 'app-office-management',
  standalone: true,
  imports: [MatDatepickerModule,
    CommonModule, FormsModule,
    MatTableModule, MatCardModule, MatIconModule,
    MatButtonModule, MatChipsModule, MatProgressSpinnerModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatSnackBarModule, TermComponent,
  ],
  template: `
    <div class="section">
      <div class="header-row">
        <button mat-flat-button color="primary" (click)="showForm.set(!showForm())">
          <mat-icon>{{ showForm() ? 'close' : 'add' }}</mat-icon>
          {{ showForm() ? '閉じる' : '事業所を追加' }}
        </button>
      </div>

      @if (showForm()) {
        <mat-card class="form-card">
          <h3>事業所の新規登録</h3>
          <div class="form-grid">
            <mat-form-field appearance="outline">
              <mat-label>事業所名</mat-label>
              <input matInput [(ngModel)]="newOffice.name" required>
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>事業所番号</mat-label>
              <input matInput [(ngModel)]="newOffice.officeNumber">
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>都道府県</mat-label>
              <mat-select [(ngModel)]="newOffice.prefectureCode">
                @for (pref of prefectureList; track pref.code) {
                  <mat-option [value]="pref.code">{{ pref.name }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>所在地</mat-label>
              <input matInput [(ngModel)]="newOffice.address">
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>電話番号</mat-label>
              <input matInput [(ngModel)]="newOffice.phone">
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>保険者番号</mat-label>
              <input matInput [(ngModel)]="newOffice.insurerId">
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>締日</mat-label>
              <input matInput type="number" [(ngModel)]="newOffice.closingDay" min="1" max="31">
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>支払日</mat-label>
              <input matInput type="number" [(ngModel)]="newOffice.paymentDay" min="1" max="31">
            </mat-form-field>
          </div>
          <div class="form-actions">
            <button mat-flat-button color="primary" (click)="createOffice()" [disabled]="saving() || !newOffice.name">
              @if (saving()) { <mat-spinner diameter="20"></mat-spinner> }
              登録
            </button>
          </div>
        </mat-card>
      }

      @if (needsMigration().length > 0) {
        <div class="migration" role="status">
          <mat-icon aria-hidden="true">info</mat-icon>
          <div>
            <strong>{{ needsMigration().length }}件の事業所の<app-term key="rounding" />が「切捨て」のままです。</strong>
            以前の画面では選べず、自動で「切捨て」になっていました。労使の取り決めがなければ、法定のルールに移してください。
          </div>
          <button mat-stroked-button (click)="migrate()" [disabled]="migrating()">
            {{ migrating() ? '確認中…' : '法定のルールに移す' }}
          </button>
        </div>
      }

      @if (editing(); as e) {
        <mat-card class="form-card">
          <h3>{{ e.name }} の設定</h3>
          <div class="form-grid">
            <mat-form-field appearance="outline"><mat-label>都道府県</mat-label>
              <mat-select [(ngModel)]="e.prefectureCode">@for (pref of prefectureList; track pref.code) { <mat-option [value]="pref.code">{{ pref.name }}</mat-option> }</mat-select></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>管轄年金事務所</mat-label>
              <input matInput [(ngModel)]="e.pensionOfficeName" maxlength="100"></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>健康保険の区分</mat-label>
              <mat-select [(ngModel)]="e.healthInsuranceType">
                <mat-option value="kyokai">協会けんぽ（都道府県の料率）</mat-option>
                <mat-option value="union">組合健保（保険者番号の料率）</mat-option>
              </mat-select></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>保険者番号{{ e.healthInsuranceType === 'union' ? '（必須）' : '' }}</mat-label>
              <input matInput [(ngModel)]="e.insurerId" maxlength="20"></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>事業所番号（5桁、任意）</mat-label>
              <input matInput [(ngModel)]="e.officeCode" maxlength="5"></mat-form-field>
          </div>
          @if (e.healthInsuranceType === 'union') { <p class="hint">組合健保の料率（本人と会社の負担割合つき）は、設定の「料率」で保険者番号を指定して登録します。</p> }
          <div class="form-actions">
            <button mat-button type="button" (click)="editing.set(null)">閉じる</button>
            <button mat-flat-button color="primary" type="button" (click)="saveEdit(e)" [disabled]="savingId() === e.id">保存</button>
          </div>
          <h3>事業所の廃止</h3>
          <p class="hint">在籍している従業員が0人で、進行中の手続きがないときだけ廃止できます。廃止した事業所は消さずに残り、過去の保険料・届出から見られます。従業員の配属先には選べなくなります。</p>
          <div class="abolish">
            <mat-form-field appearance="outline"><mat-label>廃止日</mat-label><input matInput [(ngModel)]="e.abolishedOn" [matDatepicker]="dp1" placeholder="YYYY/MM/DD"><mat-datepicker-toggle matIconSuffix [for]="dp1" /><mat-datepicker #dp1 /></mat-form-field>
            <button mat-stroked-button type="button" class="danger" (click)="abolish(e)" [disabled]="!e.abolishedOn || savingId() === e.id">この事業所を廃止する</button>
          </div>
        </mat-card>
      }

      @if (loading()) {
        <div class="loading"><mat-spinner diameter="40"></mat-spinner></div>
      } @else {
        <mat-card>
          <table mat-table [dataSource]="offices()" class="full-width-table">
            <ng-container matColumnDef="officeNumber">
              <th mat-header-cell *matHeaderCellDef>事業所番号</th>
              <td mat-cell *matCellDef="let row">{{ row.officeNumber }}</td>
            </ng-container>
            <ng-container matColumnDef="name">
              <th mat-header-cell *matHeaderCellDef>事業所名</th>
              <td mat-cell *matCellDef="let row">{{ row.name }}</td>
            </ng-container>
            <ng-container matColumnDef="address">
              <th mat-header-cell *matHeaderCellDef>所在地</th>
              <td mat-cell *matCellDef="let row">{{ row.address }}</td>
            </ng-container>
            <ng-container matColumnDef="phone">
              <th mat-header-cell *matHeaderCellDef>電話番号</th>
              <td mat-cell *matCellDef="let row">{{ row.phone }}</td>
            </ng-container>
            <ng-container matColumnDef="paymentInfo">
              <th mat-header-cell *matHeaderCellDef>締日/支払日</th>
              <td mat-cell *matCellDef="let row">
                {{ row.closingDay === 0 ? '末日' : row.closingDay + '日' }}締 / {{ row.paymentDay }}日払
              </td>
            </ng-container>
            <ng-container matColumnDef="rounding">
              <th mat-header-cell *matHeaderCellDef>端数処理 <app-term key="rounding" [showLabel]="false" /></th>
              <td mat-cell *matCellDef="let row">
                <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-select [ngModel]="row.roundingRule ?? 'truncate'" (ngModelChange)="changeRounding(row, $event)"
                        [disabled]="savingId() === row.id || row.version === undefined" [attr.aria-label]="row.name + 'の端数処理'">
                  @for (r of roundingOptions; track r.value) { <mat-option [value]="r.value">{{ r.label }}</mat-option> }
                </mat-select></mat-form-field>
                @if (row.version === undefined) { <div class="hint">サーバーの更新後に変更できます</div> }
              </td>
            </ng-container>
            <ng-container matColumnDef="bonusMonths">
              <th mat-header-cell *matHeaderCellDef>賞与の支給予定月 <app-term key="bonusNonPayment" [showLabel]="false" /></th>
              <td mat-cell *matCellDef="let row">
                @if (bonusEditing()?.id === row.id) {
                  <div class="months" role="group" [attr.aria-label]="row.name + 'の賞与の支給予定月'">
                    @for (m of monthList; track m) {
                      <label><input type="checkbox" [checked]="bonusEditing()!.months.includes(m)" (change)="toggleBonusMonth(m)">{{ m }}月</label>
                    }
                  </div>
                  <button mat-flat-button type="button" (click)="saveBonusMonths(row)" [disabled]="savingId() === row.id">保存</button>
                  <button mat-button type="button" (click)="bonusEditing.set(null)">やめる</button>
                } @else {
                  {{ row.bonusMonths?.length ? row.bonusMonths.join('・') + '月' : '未登録' }}
                  @if (row.version !== undefined && row.bonusMonths) {
                    <button mat-button type="button" (click)="bonusEditing.set({ id: row.id, months: [...row.bonusMonths] })" [attr.aria-label]="row.name + 'の賞与の支給予定月を変更'">変更</button>
                  }
                }
              </td>
            </ng-container>
            <ng-container matColumnDef="insurer">
              <th mat-header-cell *matHeaderCellDef>健康保険</th>
              <td mat-cell *matCellDef="let row">{{ row.healthInsuranceType === 'union' ? '組合健保' : '協会けんぽ' }}@if (row.insurerId) { <div class="hint">{{ row.insurerId }}</div> }</td>
            </ng-container>
            <ng-container matColumnDef="status">
              <th mat-header-cell *matHeaderCellDef>状態</th>
              <td mat-cell *matCellDef="let row">
                @if (row.abolishedOn) {
                  <span class="status-chip inactive">廃止（{{ row.abolishedOn }}）</span>
                } @else if (row.setupIssues?.length) {
                  <span class="status-chip warn">設定が終わっていません</span>
                  <div class="hint">配属できません。足りない設定：{{ row.setupIssues.join('・') }}</div>
                } @else {
                  <span class="status-chip" [class.inactive]="!row.isActive">{{ row.isActive ? '配属できます' : '無効' }}</span>
                }
                @if (!row.abolishedOn && row.version !== undefined) { <button mat-button type="button" (click)="startEdit(row)">設定</button> }
              </td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="columns"></tr>
            <tr mat-row *matRowDef="let row; columns: columns"></tr>
          </table>
          @if (offices().length === 0) {
            <div class="empty-state">
              <mat-icon>business</mat-icon>
              <p>事業所が登録されていません</p>
            </div>
          }
        </mat-card>
      }
    </div>
  `,
  styles: [`
    .section { padding: 24px 0; }
    .header-row { margin-bottom: 16px; }
    .form-card { padding: 24px; margin-bottom: 16px; }
    .form-card h3 { margin: 0 0 16px; font-size: 18px; font-weight: 500; }
    .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 16px; }
    .form-actions { display: flex; justify-content: flex-end; margin-top: 8px; }
    .full-width-table { width: 100%; }
    .loading { display: flex; justify-content: center; padding: 48px; }
    .empty-state { text-align: center; padding: 48px; color: #666; }
    .empty-state mat-icon { font-size: 48px; width: 48px; height: 48px; color: #ccc; }
    .status-chip { padding: 4px 12px; border-radius: 16px; font-size: 12px; background: #e8f5e9; color: #2e7d32; }
    .status-chip.inactive { background: #f5f5f5; color: #999; }
    .status-chip.warn { background: var(--app-status-action-bg); color: var(--app-status-action-fg); }
    .abolish { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
    .danger { color: var(--app-status-action-fg); }
    .months { display: flex; flex-wrap: wrap; gap: 2px 8px; max-width: 260px; margin-bottom: 4px; }
    .months label { display: inline-flex; align-items: center; gap: 2px; white-space: nowrap; }
    .rounding-select { padding: 6px 8px; max-width: 260px; font: inherit; }
    .hint { font-size: var(--app-font-xs); color: var(--app-color-text-sub); margin-top: 2px; }
    .migration { display: flex; align-items: center; gap: var(--app-space-3); flex-wrap: wrap; margin-bottom: var(--app-space-4);
      padding: var(--app-space-3) var(--app-space-4); border-radius: var(--app-radius); background: var(--app-status-yours-bg); line-height: 1.7; }
    .migration > div { flex: 1; min-width: 280px; }
    .migration mat-icon { color: var(--app-status-yours-fg); }
  `],
})
export class OfficeManagementComponent implements OnInit {
  private functions = inject(Functions);
  private auth = inject(AuthService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);

  offices = signal<OfficeRow[]>([]);
  loading = signal(false);
  saving = signal(false);
  showForm = signal(false);
  savingId = signal('');
  migrating = signal(false);

  readonly roundingOptions = (Object.keys(ROUNDING_LABELS) as RoundingRule[]).map(value => ({ value, label: ROUNDING_LABELS[value] }));
  /** 移行の対象（サーバーの migrateOfficeRoundingRule と同じ条件：切捨てか未設定） */
  needsMigration = computed(() => this.offices().filter(o => !o.roundingRule || o.roundingRule === 'truncate'));

  columns = ['officeNumber', 'name', 'address', 'insurer', 'paymentInfo', 'rounding', 'bonusMonths', 'status'];
  /** 設定を直している事業所（都道府県・区分・保険者番号・管轄年金事務所、廃止） */
  editing = signal<OfficeEdit | null>(null);
  readonly monthList = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  /** 賞与の支給予定月を編集中の事業所 */
  bonusEditing = signal<{ id: string; months: number[] } | null>(null);

  prefectureList = Object.entries(PREFECTURES).map(([code, name]) => ({ code, name }));

  newOffice = {
    name: '', officeNumber: '', prefectureCode: '', address: '',
    phone: '', insurerId: '', closingDay: 25, paymentDay: 25,
  };

  async ngOnInit() {
    await this.loadOffices();
  }

  async loadOffices() {
    this.loading.set(true);
    try {
      const fn = httpsCallable<any, any>(this.functions, 'officeList');
      // 廃止した事業所も出し、配属できるか（設定の不足・料率）も調べる
      const result = await fn({ companyId: this.auth.companyId, includeInactive: true, withSetup: true });
      this.offices.set(result.data.items ?? []);
    } catch {
      this.offices.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  async createOffice() {
    if (!this.newOffice.name) return;
    this.saving.set(true);
    try {
      const fn = httpsCallable<any, any>(this.functions, 'officeCreate');
      await fn({
        companyId: this.auth.companyId,
        ...this.newOffice,
        closingDay: Number(this.newOffice.closingDay),
        paymentDay: Number(this.newOffice.paymentDay),
      });
      this.snackBar.open('事業所を登録しました', '閉じる', { duration: 3000 });
      this.newOffice = {
        name: '', officeNumber: '', prefectureCode: '', address: '',
        phone: '', insurerId: '', closingDay: 25, paymentDay: 25,
      };
      this.showForm.set(false);
      await this.loadOffices();
    } catch (e: any) {
      this.snackBar.open(`エラー: ${e.message}`, '閉じる', { duration: 5000 });
    } finally {
      this.saving.set(false);
    }
  }

  async changeRounding(row: OfficeRow, rule: RoundingRule) {
    if (rule === row.roundingRule || row.version === undefined) return;
    const ok = await this.confirm(`${row.name}の端数処理を変更しますか`,
      `「${ROUNDING_LABELS[rule]}」に変更します。変更後に計算する保険料から使います（計算済みの保険料は変わりません）。`, '変更する');
    if (!ok) {
      // 選択を元に戻す（行を作り直さないと select の表示が戻らない）
      await this.loadOffices();
      return;
    }
    this.savingId.set(row.id);
    try {
      await httpsCallable(this.functions, 'officeUpdate')({
        companyId: this.auth.companyId, officeId: row.id, roundingRule: rule, expectedVersion: row.version,
      });
      this.snackBar.open('端数処理を変更しました', '閉じる', { duration: 3000 });
    } catch (e: unknown) {
      this.snackBar.open(`変更できませんでした：${e instanceof Error ? e.message : ''}`, '閉じる', { duration: 6000 });
    } finally {
      this.savingId.set('');
      await this.loadOffices();
    }
  }

  startEdit(row: OfficeRow) {
    this.editing.set({
      id: row.id, version: row.version ?? 1, name: row.name, prefectureCode: row.prefectureCode ?? '', healthInsuranceType: row.healthInsuranceType ?? 'kyokai',
      insurerId: row.insurerId ?? '', pensionOfficeName: row.pensionOfficeName ?? '', officeCode: row.officeCode ?? '', abolishedOn: '',
    });
  }

  async saveEdit(e: OfficeEdit) {
    this.savingId.set(e.id);
    try {
      await httpsCallable(this.functions, 'officeUpdate')({
        companyId: this.auth.companyId, officeId: e.id, expectedVersion: e.version,
        prefectureCode: e.prefectureCode || undefined, healthInsuranceType: e.healthInsuranceType, insurerId: e.insurerId.trim(),
        pensionOfficeName: e.pensionOfficeName.trim() || null, officeCode: e.officeCode.trim() || null,
      });
      this.snackBar.open(`${e.name}の設定を保存しました`, '閉じる', { duration: 3000 });
      this.editing.set(null);
      await this.loadOffices();
    } catch (err: unknown) {
      this.snackBar.open(`保存できませんでした：${err instanceof Error ? err.message : ''}`, '閉じる', { duration: 6000 });
    } finally {
      this.savingId.set('');
    }
  }

  async abolish(e: OfficeEdit) {
    const ok = await this.confirm(`${e.name}を廃止しますか`,
      `${e.abolishedOn}付けで廃止します。在籍している従業員がいる・進行中の手続きがある場合は廃止できません。廃止した事業所は消さずに残り、元に戻す操作はありません。`, '廃止する');
    if (!ok) return;
    this.savingId.set(e.id);
    try {
      await httpsCallable(this.functions, 'officeAbolish')({ companyId: this.auth.companyId, officeId: e.id, abolishedOn: e.abolishedOn, expectedVersion: e.version });
      this.snackBar.open(`${e.name}を廃止しました`, '閉じる', { duration: 4000 });
      this.editing.set(null);
      await this.loadOffices();
    } catch (err: unknown) {
      this.snackBar.open(`廃止できませんでした：${err instanceof Error ? err.message : ''}`, '閉じる', { duration: 8000 });
    } finally {
      this.savingId.set('');
    }
  }

  toggleBonusMonth(month: number) {
    this.bonusEditing.update(e => e && { ...e, months: e.months.includes(month) ? e.months.filter(m => m !== month) : [...e.months, month].sort((a, b) => a - b) });
  }

  /** 賞与の支給予定月。予定月に賞与が登録されないと、賞与の画面とホームで不支給報告書の提出を知らせる */
  async saveBonusMonths(row: OfficeRow) {
    const editing = this.bonusEditing();
    if (!editing || row.version === undefined) return;
    this.savingId.set(row.id);
    try {
      await httpsCallable(this.functions, 'officeUpdate')({
        companyId: this.auth.companyId, officeId: row.id, bonusMonths: editing.months, expectedVersion: row.version,
      });
      this.snackBar.open('賞与の支給予定月を保存しました', '閉じる', { duration: 3000 });
      this.bonusEditing.set(null);
    } catch (e: unknown) {
      this.snackBar.open(`保存できませんでした：${e instanceof Error ? e.message : ''}`, '閉じる', { duration: 6000 });
    } finally {
      this.savingId.set('');
      await this.loadOffices();
    }
  }

  /** まず変更せずに対象を確かめ、確認を取ってから移行する */
  async migrate() {
    this.migrating.set(true);
    try {
      const fn = httpsCallable<object, MigrationResult>(this.functions, 'migrateOfficeRoundingRule');
      const { data: preview } = await fn({ companyId: this.auth.companyId, dryRun: true });
      if (preview.offices.length === 0) {
        this.snackBar.open('移す対象の事業所はありません', '閉じる', { duration: 3000 });
        return;
      }
      const names = preview.offices.map(o => o.name).join('、');
      const ok = await this.confirm('端数処理を法定のルールに移しますか',
        `${names}（${preview.offices.length}件）を「${ROUNDING_LABELS.statutory}」に変更します。労使の取り決めで切捨てにしている事業所は、移した後に個別に設定し直してください。`,
        '移す');
      if (!ok) return;
      const { data } = await fn({ companyId: this.auth.companyId, dryRun: false });
      this.snackBar.open(`${data.offices.length}件の事業所を法定のルールに移しました`, '閉じる', { duration: 4000 });
      await this.loadOffices();
    } catch (e: unknown) {
      this.snackBar.open(`移せませんでした：${e instanceof Error ? e.message : ''}`, '閉じる', { duration: 6000 });
    } finally {
      this.migrating.set(false);
    }
  }

  private async confirm(title: string, message: string, confirmLabel: string) {
    const ref = this.dialog.open(ConfirmDialogComponent, { data: { title, message, confirmLabel }, width: '480px' });
    return (await firstValueFrom(ref.afterClosed())) === true;
  }
}
