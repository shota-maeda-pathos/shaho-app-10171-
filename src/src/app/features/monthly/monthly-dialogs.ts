import { Component, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../core/services/auth.service';
import { TermComponent } from '../../shared/ui';
import { MonthlyRow, StepKey } from './monthly.types';

const METHOD_LABELS: Record<string, string> = { payroll: '給与から控除', transfer: '別途入金', refund: '返金', legacy: '記録' };

/** 無給として記録するときの理由 */
@Component({
  selector: 'app-no-pay-dialog',
  standalone: true,
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule, TermComponent],
  template: `
    <h2 mat-dialog-title>{{ data.count }}名を無給として記録する</h2>
    <mat-dialog-content>
      <p>
        この月に支給する給与がない人（無給の休職など）として記録します。保険料は等級から計算されるため、休業の免除がなければかかります。
        本人負担分は給与から引けないため、別途入金<app-term key="separateCollection" [showLabel]="false" />で集めます。
      </p>
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>理由</mat-label>
        <input matInput [(ngModel)]="reason" maxlength="200" required placeholder="例：私傷病による休職（無給）">
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">やめる</button>
      <button mat-flat-button type="button" [mat-dialog-close]="reason" [disabled]="!reason.trim()">記録する</button>
    </mat-dialog-actions>
  `,
  styles: [`.full-width { width: 100%; } p { line-height: 1.7; }`],
})
export class NoPayDialogComponent {
  data = inject<{ count: number }>(MAT_DIALOG_DATA);
  reason = '';
}

/** 1人分の詳細。無給の記録と、別途入金・返金の記録はここで行う */
@Component({
  selector: 'app-monthly-detail-dialog',
  standalone: true,
  imports: [DecimalPipe, FormsModule, RouterLink, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <h2 mat-dialog-title>{{ r.name }}（{{ r.employeeNumber }}）</h2>
    <mat-dialog-content>
      @if (r.hold) { <p class="hold">保留中：{{ r.hold.reason }}</p> }
      @for (i of r.issues; track i) { <p class="bad">{{ i }}</p> }
      @if (r.rejected?.salary) { <p class="bad">給与が差し戻されました。理由：{{ r.rejected?.salary }}</p> }
      @if (r.rejected?.premium) { <p class="bad">保険料が差し戻されました。理由：{{ r.rejected?.premium }}</p> }
      @for (w of r.warnings; track w) { <p class="warn">{{ w }}</p> }
      @if (r.otherEmployer) { <p class="warn">二以上事業所勤務（ほかに「{{ r.otherEmployer }}」）です。本システムでは保険料の按分をしないため、別途確かめてください。</p> }
      @if (r.revision; as rv) {
        <div class="row-actions">
          @if (rv.procedureId) {
            <a mat-stroked-button [routerLink]="['/revisions', rv.procedureId]" mat-dialog-close>{{ rv.procedureDone ? '随時改定の手続きを見る' : '随時改定の手続きを開く' }}</a>
          } @else {
            <a mat-flat-button [routerLink]="['/revisions', 'new']" [queryParams]="{ employeeId: r.employeeId, startMonth: rv.startMonth }" mat-dialog-close>随時改定の対象か確かめる</a>
          }
        </div>
      }

      <h3>{{ month(data.payMonth) }}支給の給与</h3>
      @if (r.salary; as s) {
        <dl>
          <div><dt>支給額</dt><dd>{{ s.noPay ? '無給（' + s.noPayReason + '）' : (s.total | number) + '円' }}</dd></div>
          @if (s.inKind) { <div><dt>現物給与</dt><dd>{{ s.inKind | number }}円</dd></div> }
          <div><dt>支払基礎日数</dt><dd>{{ s.basisDays }}日</dd></div>
          <div><dt>状態</dt><dd>{{ s.confirmed ? '承認済み' : s.pending ? '承認待ち' : '確認の依頼前' }}{{ s.published ? '・明細公開済み' : '' }}</dd></div>
        </dl>
      } @else if (r.salaryRequired) {
        <p>まだ登録されていません。</p>
      } @else {
        <p>この月は在籍していないため、給与はありません。</p>
      }
      @if (r.salaryRequired && !r.salary?.confirmed && !r.salary?.pending) {
        <div class="row-actions">
          <a mat-stroked-button [routerLink]="['/salary', r.employeeId]" [queryParams]="{ yearMonth: data.payMonth, officeId: data.officeId }" mat-dialog-close>給与を1人分入力・修正する</a>
        </div>
      }

      <h3>{{ month(data.premiumMonth) }}分の保険料</h3>
      @if (r.premium; as p) {
        <dl>
          <div><dt>本人負担</dt><dd>{{ p.employee | number }}円</dd></div>
          <div><dt>会社負担</dt><dd>{{ p.employer | number }}円</dd></div>
          <div><dt>等級</dt><dd>健保 {{ p.healthGrade }}・厚年 {{ p.pensionGrade }}{{ p.exempted ? '（産休・育休の免除）' : '' }}</dd></div>
          @if (r.previous) { <div><dt>前月</dt><dd>本人 {{ r.previous.employee | number }}円・会社 {{ r.previous.employer | number }}円</dd></div> }
          @if (r.diffReasons.length) { <div><dt>差の理由</dt><dd>{{ r.diffReasons.join('／') }}</dd></div> }
          <div><dt>状態</dt><dd>{{ p.confirmed ? '承認済み' : p.pending ? '承認待ち' : '確認の依頼前' }}</dd></div>
        </dl>
      } @else {
        <p>{{ r.premiumNote || (r.premiumDue ? 'まだ計算していません。' : '保険料はかかりません。') }}</p>
      }

      @if (r.premium?.confirmed && r.collection.plan !== 'none') {
        <h3>徴収</h3>
        <dl>
          <div><dt>集め方</dt><dd>{{ r.collection.plan === 'payroll' ? '給与から控除' : '別途入金' }}</dd></div>
          <div><dt>徴収済み / 集める額</dt><dd>{{ r.collection.collected ?? 0 | number }} / {{ r.collection.due | number }}円</dd></div>
        </dl>
        @if (r.collection.entries.length) {
          <ul class="entries">
            @for (e of r.collection.entries; track $index) {
              <li>{{ methodLabel(e.method) }} {{ e.amount | number }}円 {{ e.date }} {{ e.note }}</li>
            }
          </ul>
        }
        <form class="entry" (ngSubmit)="addEntry()">
          <mat-form-field appearance="outline">
            <mat-label>種類</mat-label>
            <mat-select [(ngModel)]="method" name="method">
              <mat-option value="transfer">別途入金を受け取った</mat-option>
              <mat-option value="payroll">給与から控除した</mat-option>
              <mat-option value="refund">返金した</mat-option>
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>金額（円）</mat-label>
            <input matInput type="number" min="1" [(ngModel)]="amount" name="amount" required>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>日付</mat-label>
            <input matInput type="date" [(ngModel)]="date" name="date" required>
          </mat-form-field>
          <mat-form-field appearance="outline" class="wide">
            <mat-label>メモ</mat-label>
            <input matInput [(ngModel)]="note" name="note" maxlength="200" required placeholder="例：11月5日 振込を確認">
          </mat-form-field>
          <button mat-flat-button type="submit" [disabled]="saving() || !amount || amount < 1 || !date || !note.trim()">記録する</button>
        </form>
        @if (error()) { <p class="bad" role="alert">{{ error() }}</p> }
      }

      @if (r.salary?.pending || r.premium?.pending) {
        <p class="hint">内容を直す必要があるときは、<a routerLink="/approvals" mat-dialog-close>承認の画面</a>で差し戻してください。</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" (click)="close()">閉じる</button>
    </mat-dialog-actions>
  `,
  styles: [`
    h3 { margin: var(--app-space-4) 0 var(--app-space-2); font-size: var(--app-font-md); }
    dl { margin: 0; display: grid; gap: var(--app-space-1); }
    dl div { display: grid; grid-template-columns: 9em 1fr; gap: var(--app-space-2); }
    dt { color: var(--app-color-text-sub); }
    dd { margin: 0; }
    .bad { color: var(--app-status-action-fg); }
    .warn, .hold { color: var(--app-color-text-sub); background: var(--app-color-surface-sub); padding: var(--app-space-2); border-radius: var(--app-radius); }
    .row-actions { margin-top: var(--app-space-2); }
    .entries { margin: var(--app-space-2) 0; padding-left: 1.2em; }
    .entry { display: flex; flex-wrap: wrap; gap: var(--app-space-2); align-items: center; margin-top: var(--app-space-3); }
    .entry mat-form-field { width: 11em; }
    .entry .wide { flex: 1 1 14em; }
    .hint { color: var(--app-color-text-sub); }
    a { color: var(--app-color-link); }
    a[mat-stroked-button] { color: inherit; }
  `],
})
export class MonthlyDetailDialogComponent {
  data = inject<{ row: MonthlyRow; payMonth: string; premiumMonth: string; officeId: string; step: StepKey }>(MAT_DIALOG_DATA);
  private ref = inject(MatDialogRef<MonthlyDetailDialogComponent>);
  private functions = inject(Functions);
  private auth = inject(AuthService);

  r = this.data.row;
  method: 'transfer' | 'payroll' | 'refund' = this.data.row.collection.status === 'over' ? 'refund' : this.data.row.collection.plan === 'payroll' ? 'payroll' : 'transfer';
  amount = Math.abs(this.data.row.collection.due - (this.data.row.collection.collected ?? 0));
  date = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  note = '';
  saving = signal(false);
  error = signal('');
  private changed = false;

  month(ym: string) { const [y, m] = ym.split('-'); return `${y}年${Number(m)}月`; }
  methodLabel(m: string) { return METHOD_LABELS[m] ?? m; }

  async addEntry() {
    this.saving.set(true);
    this.error.set('');
    try {
      await httpsCallable(this.functions, 'monthlyCollectionEntry')({
        companyId: this.auth.companyId, officeId: this.data.officeId, payMonth: this.data.payMonth, employeeId: this.r.employeeId,
        method: this.method, amount: Number(this.amount), date: this.date, note: this.note.trim(), expectedVersion: this.r.collection.version,
      });
      this.changed = true;
      this.ref.close(true);
    } catch (e) {
      this.error.set(e instanceof Error && e.message ? e.message : '記録できませんでした');
    } finally {
      this.saving.set(false);
    }
  }

  close() { this.ref.close(this.changed); }
}
