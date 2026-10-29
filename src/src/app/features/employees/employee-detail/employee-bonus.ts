import { Component, Input, Output, EventEmitter, OnInit, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../../core/services/auth.service';
interface Bonus { yearMonth: string; totalAmount: number; standardBonusAmount: number; cumulativeBonusAmount: number; version: number; isConfirmed: boolean; approvalPending: boolean; }
interface Insurance { yearMonth: string; version: number; bonusVersion: number | null; healthCappedAmount: number; pensionCappedAmount: number; healthEmployee: number | null; pensionEmployee: number | null; longTermCareEmployee: number | null; childSupportEmployer: number | null; totalEmployee: number; totalEmployer: number; isConfirmed: boolean; approvalPending: boolean; isExempted: boolean; }
@Component({
  selector: 'app-employee-bonus', standalone: true,
  imports: [FormsModule, DecimalPipe, RouterLink, MatButtonModule, MatFormFieldModule, MatInputModule],
  template: `
    <h2>賞与の登録・保険料計算</h2>
    <p>賞与額を保存 → 賞与額を承認 → 保険料計算 → 計算結果を承認、の順に進めます。</p>
    <div class="fields">
      <mat-form-field appearance="outline"><mat-label>支給年月</mat-label>
        <input matInput type="month" [(ngModel)]="month" (change)="load()" [disabled]="busy()">
      </mat-form-field>
      <button mat-stroked-button (click)="load()" [disabled]="busy()">再読み込み</button>
      <a mat-stroked-button routerLink="/approvals">承認画面を開く</a>
    </div>
    @if (error()) { <p role="alert">{{ error() }}</p> }
    @if (message()) { <p role="status">{{ message() }}</p> }
    @if (busy()) { <p>処理中...</p> }
    @if (ready()) {
      <form #form="ngForm" (ngSubmit)="save()">
        <p>賞与額の状態：{{ status(bonus()) }}</p>
        <div class="fields">
          <mat-form-field appearance="outline"><mat-label>同月の賞与総額（円）</mat-label>
            <input matInput type="number" name="total" [(ngModel)]="total" required min="0" step="1" [disabled]="locked() || busy()">
          </mat-form-field>
          <mat-form-field appearance="outline"><mat-label>年度の標準賞与累計（今回を含む・円）</mat-label>
            <input matInput type="number" name="cumulative" [(ngModel)]="cumulative" required min="0" step="1000" [disabled]="locked() || busy()">
          </mat-form-field>
        </div>
        <p>標準賞与額：{{ standard() | number }} 円。同じ月の複数回支給は合算してください。</p>
        <p>年度累計は4月〜翌3月の今回までの標準賞与額です。過去の支給や免除期間の賞与も確認して入力してください。過去の賞与からの自動集計は行いません。</p>
        <button mat-flat-button type="submit" [disabled]="form.invalid || busy() || locked() || !validAmounts()">{{ bonus() ? '下書きを更新' : '賞与額を保存' }}</button>
        @if (bonus(); as b) {
          <button mat-stroked-button type="button" (click)="submit('bonus')" [disabled]="busy() || b.isConfirmed || b.approvalPending || dirty()">賞与額を承認申請</button>
        }
      </form>
      <hr>
      <h3>賞与保険料</h3>
      <button mat-flat-button (click)="calculate()" [disabled]="busy() || !bonus()?.isConfirmed || !!insurance()?.isConfirmed || !!insurance()?.approvalPending">{{ insurance() ? '保険料を再計算' : '保険料を計算' }}</button>
      @if (!bonus()?.isConfirmed) { <p>賞与額の承認後に計算できます。</p> }
      @if (insurance(); as i) {
        <p>状態：{{ status(i) }} {{ i.isExempted ? '（免除適用）' : '' }}</p>
        <p>健康保険の対象額：{{ i.healthCappedAmount | number }} 円 ／ 厚生年金の対象額：{{ i.pensionCappedAmount | number }} 円</p>
        <p>本人負担：健康保険 {{ i.healthEmployee === null ? '未登録' : (i.healthEmployee | number) + ' 円' }} ／ 厚生年金 {{ i.pensionEmployee === null ? '未登録' : (i.pensionEmployee | number) + ' 円' }} ／ 介護 {{ i.longTermCareEmployee === null ? '未登録' : (i.longTermCareEmployee | number) + ' 円' }}</p>
        <p>本人負担合計：{{ i.totalEmployee | number }} 円 ／ 会社負担合計：{{ i.totalEmployer | number }} 円</p>
        <button mat-stroked-button (click)="submit('bonusInsurance')" [disabled]="busy() || i.isConfirmed || i.approvalPending || !bonus()?.isConfirmed || i.bonusVersion !== bonus()?.version">計算結果を承認申請</button>
      } @else { <p>保存済みの計算結果はありません。</p> }
    }
  `,
  styles: [`.fields { display:flex; gap:16px; flex-wrap:wrap; align-items:center; } h2,h3 { margin:20px 0; } button,a { margin:4px; } hr { margin:24px 0; }`],
})
export class EmployeeBonusComponent implements OnInit {
  @Input({ required: true }) employeeId = '';
  @Output() changed = new EventEmitter<void>();
  private functions = inject(Functions);
  private auth = inject(AuthService);
  private updateRequest: { fingerprint: string; requestId: string } | null = null;
  month = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }).slice(0, 7);
  total: number | null = null;
  cumulative: number | null = null;
  busy = signal(false); ready = signal(false); error = signal(''); message = signal('');
  bonus = signal<Bonus | null>(null); insurance = signal<Insurance | null>(null);
  ngOnInit() { void this.load(); }
  status(row: { isConfirmed: boolean; approvalPending: boolean } | null) { return row ? row.isConfirmed ? '承認済み' : row.approvalPending ? '承認待ち' : '下書き' : '未登録'; }
  standard() { return Math.floor((this.total ?? 0) / 1000) * 1000; }
  locked() { return !!this.bonus()?.isConfirmed || !!this.bonus()?.approvalPending; }
  dirty() { return this.bonus()?.totalAmount !== this.total || this.bonus()?.cumulativeBonusAmount !== this.cumulative; }
  validAmounts() { return Number.isSafeInteger(this.total) && this.total! >= 0 && Number.isSafeInteger(this.cumulative) && this.cumulative! >= this.standard() && this.cumulative! % 1000 === 0; }
  private payload() { return { companyId: this.auth.companyId, employeeId: this.employeeId, yearMonth: this.month }; }
  private async refresh() {
    const fn = httpsCallable<object, { bonus: Bonus | null; insurance: Insurance | null }>(this.functions, 'bonusGet');
    const { data } = await fn(this.payload());
    this.bonus.set(data.bonus); this.insurance.set(data.insurance);
    this.total = data.bonus?.totalAmount ?? null; this.cumulative = data.bonus?.cumulativeBonusAmount ?? null;
    this.ready.set(true);
  }
  async load() {
    if (this.busy()) return;
    this.busy.set(true); this.ready.set(false); this.error.set(''); this.message.set('');
    try { await this.refresh(); } catch (e: any) { this.error.set(`取得できませんでした：${e.message}`); }
    finally { this.busy.set(false); }
  }
  private async mutate(action: () => Promise<unknown>, message: string) {
    if (this.busy()) return;
    this.busy.set(true); this.error.set(''); this.message.set('');
    try { await action(); this.message.set(message); this.changed.emit(); this.ready.set(false); await this.refresh(); }
    catch (e: any) { this.error.set(`${e.message ?? '処理できませんでした'}。状態を再読み込みして確認してください。`); }
    finally { this.busy.set(false); }
  }
  async save() {
    if (!this.ready() || !this.validAmounts() || this.locked()) return;
    const b = this.bonus();
    const data = { ...this.payload(), totalAmount: this.total, cumulativeBonusAmount: this.cumulative };
    if (!b) {
      await this.mutate(() => httpsCallable(this.functions, 'bonusCreate')({ ...data, standardBonusAmount: this.standard() }), '賞与額を保存しました');
    } else {
      const fingerprint = JSON.stringify({ ...data, version: b.version });
      if (this.updateRequest?.fingerprint !== fingerprint) this.updateRequest = { fingerprint, requestId: crypto.randomUUID() };
      await this.mutate(() => httpsCallable(this.functions, 'bonusUpdate')({ ...data, expectedVersion: b.version, requestId: this.updateRequest!.requestId }), '賞与額を更新しました');
    }
  }
  async calculate() {
    if (!this.ready() || !this.bonus()?.isConfirmed || this.insurance()?.isConfirmed || this.insurance()?.approvalPending) return;
    await this.mutate(() => httpsCallable(this.functions, 'bonusInsuranceCalculate')(this.payload()), '保険料を計算しました');
  }
  async submit(type: 'bonus' | 'bonusInsurance') {
    const target = type === 'bonus' ? this.bonus() : this.insurance();
    if (!this.ready() || !target || target.isConfirmed || target.approvalPending || (type === 'bonus' && this.dirty())) return;
    const collection = type === 'bonus' ? 'bonuses' : 'bonusInsurance';
    const targetPath = `companies/${this.auth.companyId}/employees/${this.employeeId}/${collection}/${this.month}`;
    await this.mutate(() => httpsCallable(this.functions, 'approvalRequestCreate')({ ...this.payload(), targetPath, targetVersion: target.version, requestType: type }), '承認申請しました。承認画面で確認できます');
  }
}
