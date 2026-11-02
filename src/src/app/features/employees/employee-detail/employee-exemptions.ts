import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../../core/services/auth.service';

import { MatDatepickerModule } from '@angular/material/datepicker';
interface Exemption {
  id: string;
  exemptionTypeLabel: string;
  startMonth: string;
  endMonth: string | null;
  status: string;
  version: number;
  approvedDate: string | null;
  isMonthlyExempted: boolean;
  isBonusExempted: boolean;
  exemptionType: string;
}
@Component({
  selector: 'app-employee-exemptions',
  standalone: true,
  imports: [MatDatepickerModule, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <h2>保険料免除管理</h2>
    <form #form="ngForm" (ngSubmit)="register()">
      <div class="fields">
        <mat-form-field appearance="outline">
          <mat-label>免除種別</mat-label>
          <mat-select name="type" [(ngModel)]="exemptionType" required>
            <mat-option value="maternity">産前産後休業の免除</mat-option>
            <mat-option value="childcare">育児休業の免除</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline"><mat-label>免除開始月</mat-label>
          <input matInput type="month" name="start" [(ngModel)]="start" required>
        </mat-form-field>
        <mat-form-field appearance="outline"><mat-label>免除終了月（任意）</mat-label>
          <input matInput type="month" name="end" [(ngModel)]="end" [min]="start">
        </mat-form-field>
        <mat-form-field appearance="outline"><mat-label>届出承認日（未承認なら空欄）</mat-label>
          <input matInput name="approved" [(ngModel)]="approvedDate" [matDatepicker]="dp1" placeholder="YYYY/MM/DD"><mat-datepicker-toggle matIconSuffix [for]="dp1" /><mat-datepicker #dp1 />
        </mat-form-field>
        <mat-form-field appearance="outline"><mat-label>月次保険料の免除</mat-label>
          <mat-select name="monthly" [(ngModel)]="monthly">
            <mat-option [value]="true">対象</mat-option>
            <mat-option [value]="false">対象外</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline"><mat-label>賞与保険料の免除</mat-label>
          <mat-select name="bonus" [(ngModel)]="bonus">
            <mat-option [value]="false">対象外</mat-option>
            <mat-option [value]="true">対象</mat-option>
          </mat-select>
        </mat-form-field>
      </div>
      <p>届出承認日には実際に承認された日を入力してください。承認済みの対象期間を、次の月次・賞与計算でそれぞれ反映します。既存の計算結果は自動更新しません。</p>
      <p>月次と賞与の免除条件は異なります。育児休業の賞与免除は、賞与月の末日を含む連続1か月超の休業などの条件を確認し、承認された対象月を登録してください。休業期間からの自動判定は行いません。</p>
      <button mat-flat-button type="submit" [disabled]="form.invalid || saving() || loading() || updating() || !start || (!!end && end < start)">
        {{ saving() ? '登録中...' : '免除期間を登録' }}
      </button>
    </form>
    <h3>免除の登録履歴</h3>
    @if (error()) {
      <p role="alert">{{ error() }}</p>
      <button mat-stroked-button (click)="load()">再読み込み</button>
    } @else if (loading()) {
      <p>読み込み中...</p>
    } @else {
      @for (exemption of exemptions(); track exemption.id) {
        <div class="record">
          <strong>{{ exemption.exemptionTypeLabel }}</strong>
          <span>{{ exemption.startMonth }} 〜 {{ exemption.endMonth ?? '終了月未定' }}</span>
          <span>{{ exemption.approvedDate ? '承認日：' + exemption.approvedDate : '未承認' }}</span>
          <span>{{ exemption.isMonthlyExempted ? '月次免除対象' : '月次免除対象外' }}</span>
          <span>{{ exemption.isBonusExempted ? '賞与免除対象' : '賞与免除対象外' }}</span>
          @if (exemption.status === 'active') {
            <button mat-stroked-button (click)="editPeriod(exemption)" [disabled]="updating() || saving()">期間・賞与対象・承認日を変更</button>
          }
          @if (editing(); as edit) {
            @if (edit.id === exemption.id) {
              <form #updateForm="ngForm" (ngSubmit)="updatePeriod()">
                <p>変更後の届出承認日を入力してください。空欄で保存すると未承認となり、次の月次・賞与計算では免除を適用しません。</p>
                <mat-form-field appearance="outline"><mat-label>終了月（空欄なら未定）</mat-label>
                  <input matInput type="month" name="updatedEndMonth" [(ngModel)]="edit.endMonth" [min]="exemption.startMonth">
                </mat-form-field>
                <mat-form-field appearance="outline"><mat-label>変更後の届出承認日（未承認なら空欄）</mat-label>
                  <input matInput name="updatedApprovalDate" [(ngModel)]="edit.approvedDate" [matDatepicker]="dp2" placeholder="YYYY/MM/DD"><mat-datepicker-toggle matIconSuffix [for]="dp2" /><mat-datepicker #dp2 />
                </mat-form-field>
                <mat-form-field appearance="outline"><mat-label>賞与保険料の免除</mat-label>
                  <mat-select name="updatedBonus" [(ngModel)]="edit.isBonusExempted">
                    <mat-option [value]="false">対象外</mat-option>
                    @if (exemption.exemptionType === 'maternity' || exemption.exemptionType === 'childcare') {
                      <mat-option [value]="true">対象</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
                <button mat-flat-button type="submit" [disabled]="updateForm.invalid || updating() || (!!edit.endMonth && edit.endMonth < exemption.startMonth)">{{ updating() ? '保存中...' : '保存' }}</button>
                <button mat-button type="button" (click)="editing.set(null)" [disabled]="updating()">キャンセル</button>
              </form>
            }
          }
        </div>
      } @empty {
        <p>免除の登録はありません。</p>
      }
      @if (hasMore()) {
        <button mat-stroked-button (click)="load(true)">さらに読み込む</button>
      }
    }
  `,
  styles: [`
    :host { display: block; }
    .fields { display: flex; flex-wrap: wrap; gap: 16px; }
    .record { display: flex; flex-wrap: wrap; gap: 20px; padding: 16px 0; border-bottom: 1px solid #ddd; }
    h3 { margin-top: 32px; }
  `],
})
export class EmployeeExemptionsComponent implements OnInit {
  @Input({ required: true }) employeeId = '';
  private functions = inject(Functions);
  private auth = inject(AuthService);
  private snackBar = inject(MatSnackBar);
  exemptions = signal<Exemption[]>([]);
  updating = signal(false);
  editing = signal<{ id: string; version: number; endMonth: string; approvedDate: string; isBonusExempted: boolean; requestId: string } | null>(null);
  editPeriod(exemption: Exemption) {
    this.editing.set({ id: exemption.id, version: exemption.version, endMonth: exemption.endMonth ?? '', approvedDate: '', isBonusExempted: exemption.isBonusExempted, requestId: crypto.randomUUID() });
  }
  async updatePeriod() {
    const edit = this.editing();
    if (!edit || this.updating()) return;
    this.updating.set(true);
    try {
      const fn = httpsCallable<object, { id: string; version: number; endMonth: string | null; approvedDate: string | null; isBonusExempted: boolean }>(this.functions, 'premiumExemptionUpdate');
      const { data } = await fn({ companyId: this.auth.companyId, employeeId: this.employeeId, exemptionId: edit.id, expectedVersion: edit.version, requestId: edit.requestId, endMonth: edit.endMonth || null, isBonusExempted: edit.isBonusExempted, ...(edit.approvedDate ? { approvedDate: edit.approvedDate } : {}) });
      this.exemptions.update(rows => rows.map(row => row.id === edit.id ? { ...row, ...data } : row));
      this.editing.set(null);
      this.snackBar.open('免除期間を更新しました。既存の計算結果は変更していません', '閉じる', { duration: 5000 });
    } catch (e: any) {
      this.snackBar.open(e.message ?? '更新できませんでした', '閉じる', { duration: 5000 });
      if (e.code === 'functions/aborted') { this.editing.set(null); await this.load(); }
    } finally { this.updating.set(false); }
  }
  loading = signal(false);
  saving = signal(false);
  error = signal('');
  hasMore = signal(false);
  exemptionType = 'maternity';
  approvedDate = '';
  monthly = true;
  bonus = false;
  start = '';
  end = '';
  ngOnInit() { void this.load(); }
  statusLabel(status: string) {
    return ({ active: '登録中', ended: '終了' } as Record<string, string>)[status] ?? status;
  }
  async load(append = false) {
    if (this.loading()) return;
    this.loading.set(true);
    this.error.set('');
    try {
      const items = this.exemptions();
      const lastDocId = append ? items.at(-1)?.id : undefined;
      const fn = httpsCallable<object, { items: Exemption[]; hasMore: boolean }>(this.functions, 'premiumExemptionList');
      const { data } = await fn({ companyId: this.auth.companyId, employeeId: this.employeeId, limit: 20, ...(lastDocId ? { lastDocId } : {}) });
      this.exemptions.set(append ? [...items, ...data.items] : data.items);
      this.hasMore.set(data.hasMore);
    } catch {
      this.error.set('免除情報を取得できませんでした。接続状況・アクセス権・APIの公開状況を確認してください。');
    } finally { this.loading.set(false); }
  }
  async register() {
    if (this.saving() || this.updating() || this.loading() || !this.start || (this.end && this.end < this.start)) return;
    this.saving.set(true);
    try {
      const fn = httpsCallable(this.functions, 'premiumExemptionCreate');
      await fn({ companyId: this.auth.companyId, employeeId: this.employeeId, exemptionType: this.exemptionType, startMonth: this.start, isMonthlyExempted: this.monthly, isBonusExempted: this.bonus, ...(this.approvedDate ? { approvedDate: this.approvedDate } : {}), ...(this.end ? { endMonth: this.end } : {}) });
      this.start = ''; this.end = ''; this.approvedDate = ''; this.monthly = true; this.bonus = false;
      this.snackBar.open('免除期間を登録しました', '閉じる', { duration: 3000 });
      await this.load();
    } catch {
      this.snackBar.open('免除期間を登録できませんでした。入力内容と接続状況を確認してください。', '閉じる', { duration: 5000 });
    } finally { this.saving.set(false); }
  }
}
