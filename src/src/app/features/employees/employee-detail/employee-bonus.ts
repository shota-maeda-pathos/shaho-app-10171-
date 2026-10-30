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
interface Insurance { yearMonth: string; healthCappedAmount: number; pensionCappedAmount: number; totalEmployee: number; totalEmployer: number; isConfirmed: boolean; approvalPending: boolean; isExempted: boolean; }

/**
 * 1人分の賞与（見るだけ）。登録・承認・保険料の計算・賞与支払届は、賞与の画面（事業所×支給月の一括型）で行う
 */
@Component({
  selector: 'app-employee-bonus', standalone: true,
  imports: [FormsModule, DecimalPipe, RouterLink, MatButtonModule, MatFormFieldModule, MatInputModule],
  template: `
    <h2>賞与</h2>
    <p>賞与の登録・承認・保険料の計算・賞与支払届は、<a [routerLink]="['/bonus']" [queryParams]="{ month }">賞与の画面</a>で事業所の全員分をまとめて行います。ここでは1人分の結果を見られます。</p>
    <div class="fields">
      <mat-form-field appearance="outline"><mat-label>支給月</mat-label>
        <input matInput type="month" [(ngModel)]="month" (change)="load()" [disabled]="busy()">
      </mat-form-field>
      <a mat-stroked-button [routerLink]="['/bonus']" [queryParams]="{ month }">賞与の画面を開く</a>
    </div>
    @if (error()) { <p role="alert">{{ error() }}</p> }
    @if (busy()) { <p>読み込んでいます…</p> }
    @if (ready()) {
      @if (bonus(); as b) {
        <dl>
          <div><dt>賞与額</dt><dd>{{ b.totalAmount | number }}円（{{ status(b) }}）</dd></div>
          <div><dt>標準賞与額</dt><dd>{{ b.standardBonusAmount | number }}円</dd></div>
          @if (insurance(); as i) {
            <div><dt>保険料の対象</dt><dd>健保 {{ i.healthCappedAmount | number }}円・厚年 {{ i.pensionCappedAmount | number }}円</dd></div>
            <div><dt>保険料</dt><dd>本人 {{ i.totalEmployee | number }}円・会社 {{ i.totalEmployer | number }}円（{{ status(i) }}）{{ i.isExempted ? '・産休育休で免除' : '' }}</dd></div>
          } @else {
            <div><dt>保険料</dt><dd>未計算</dd></div>
          }
        </dl>
      } @else {
        <p>この月の賞与は登録されていません。</p>
      }
    }
  `,
  styles: [`.fields { display:flex; gap:16px; flex-wrap:wrap; align-items:center; } h2 { margin:20px 0; } p { line-height: 1.7; }
    a:not([mat-stroked-button]) { color: var(--app-color-link); }
    dl { display: grid; gap: 4px; } dl div { display: grid; grid-template-columns: 9em 1fr; gap: 8px; } dt { color: var(--app-color-text-sub); } dd { margin: 0; }`],
})
export class EmployeeBonusComponent implements OnInit {
  @Input({ required: true }) employeeId = '';
  /** 以前の入力欄の名残（親の再読み込み用）。見るだけになったため今は出さない */
  @Output() changed = new EventEmitter<void>();
  private functions = inject(Functions);
  private auth = inject(AuthService);
  month = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }).slice(0, 7);
  busy = signal(false); ready = signal(false); error = signal('');
  bonus = signal<Bonus | null>(null); insurance = signal<Insurance | null>(null);
  ngOnInit() { void this.load(); }
  status(row: { isConfirmed: boolean; approvalPending: boolean }) { return row.isConfirmed ? '承認済み' : row.approvalPending ? '承認待ち' : '下書き'; }
  async load() {
    if (this.busy()) return;
    this.busy.set(true); this.ready.set(false); this.error.set('');
    try {
      const fn = httpsCallable<object, { bonus: Bonus | null; insurance: Insurance | null }>(this.functions, 'bonusGet');
      const { data } = await fn({ companyId: this.auth.companyId, employeeId: this.employeeId, yearMonth: this.month });
      this.bonus.set(data.bonus); this.insurance.set(data.insurance);
      this.ready.set(true);
    } catch (e: any) { this.error.set(`取得できませんでした：${e.message}`); }
    finally { this.busy.set(false); }
  }
}
