import { Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { ErrorStateComponent, LoadingStateComponent } from '../../shared/ui';
import { errorMessage, RELATIONSHIPS, SelfInput } from '../onboarding/onboarding.types';

import { MatDatepickerModule } from '@angular/material/datepicker';
interface InviteInfo {
  companyName: string;
  plannedName: string;
  hireDate: string;
  submitted: boolean;
  locked: boolean;
  data: SelfInput | null;
}

const KANA = /^[ァ-ヶー\s　]+$/;

/**
 * 入社する本人が招待リンクから入力する画面（ログイン不要）。
 * 入力 → 確認 → 送信 の3段階。送った内容は会社の担当者が確かめてから台帳に登録する。
 */
@Component({
  selector: 'app-onboard-form',
  standalone: true,
  imports: [MatDatepickerModule, DatePipe, FormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule, LoadingStateComponent, ErrorStateComponent],
  template: `
    <main class="page">
      @if (loading()) {
        <app-loading-state />
      } @else if (loadError()) {
        <app-error-state heading="入力画面を開けませんでした" [message]="loadError()" [retryable]="false" />
      } @else if (info(); as i) {
        <header>
          <div class="company">{{ i.companyName }}</div>
          <h1>入社の手続きに必要な情報の入力</h1>
          <p>{{ i.plannedName }}さん、入社日（{{ i.hireDate | date:'yyyy年M月d日' }}）の前に、健康保険・厚生年金の届出に使う情報を入力してください。
            入力した内容は会社の担当者だけが見ます。</p>
        </header>

        @if (i.locked) {
          <section class="panel done"><mat-icon aria-hidden="true">check_circle</mat-icon>
            <p>会社での登録が済んでいます。内容を変える場合は、会社の担当者に連絡してください。</p></section>
        } @else if (stage() === 'done') {
          <section class="panel done"><mat-icon aria-hidden="true">check_circle</mat-icon>
            <p><strong>送信しました。</strong>会社の担当者が内容を確かめます。直したいときは、このページをもう一度開いて送り直せます。</p></section>
        } @else if (stage() === 'confirm') {
          <section class="panel">
            <h2>入力内容の確認</h2>
            <dl class="confirm">
              <div><dt>氏名</dt><dd>{{ f.lastName }} {{ f.firstName }}（{{ f.lastNameKana }} {{ f.firstNameKana }}）</dd></div>
              <div><dt>生年月日</dt><dd>{{ f.birthDate | date:'yyyy年M月d日' }}</dd></div>
              <div><dt>性別</dt><dd>{{ f.gender === 'male' ? '男' : '女' }}</dd></div>
              <div><dt>住所</dt><dd>{{ f.postalCode ? '〒' + f.postalCode + ' ' : '' }}{{ f.prefecture }}{{ f.city }}{{ f.addressLine }} {{ f.building }}</dd></div>
              <div><dt>電話番号</dt><dd>{{ f.phone || '—' }}</dd></div>
              <div><dt>メールアドレス</dt><dd>{{ f.email || '—' }}</dd></div>
              <div><dt>扶養に入れたい家族</dt><dd>
                @for (d of f.dependents; track $index) { <div>{{ d.lastName }} {{ d.firstName }}（{{ relationships[d.relationship] }}）</div> }
                @empty { いない }
              </dd></div>
            </dl>
            @if (submitError()) { <p class="error" role="alert">{{ submitError() }}</p> }
            <div class="actions">
              <button mat-stroked-button type="button" (click)="stage.set('form')" [disabled]="sending()">直す</button>
              <button mat-flat-button type="button" (click)="send()" [disabled]="sending()">{{ sending() ? '送信しています…' : 'この内容で送信する' }}</button>
            </div>
          </section>
        } @else {
          <section class="panel">
            @if (i.submitted) { <p class="note">前に送った内容を表示しています。直して送り直せます。</p> }
            <h2>あなたのこと</h2>
            <div class="grid">
              <mat-form-field appearance="outline"><mat-label>姓</mat-label><input matInput [(ngModel)]="f.lastName" required autocomplete="family-name"></mat-form-field>
              <mat-form-field appearance="outline"><mat-label>名</mat-label><input matInput [(ngModel)]="f.firstName" required autocomplete="given-name"></mat-form-field>
              <mat-form-field appearance="outline"><mat-label>姓（フリガナ・カタカナ）</mat-label><input matInput [(ngModel)]="f.lastNameKana" required></mat-form-field>
              <mat-form-field appearance="outline"><mat-label>名（フリガナ・カタカナ）</mat-label><input matInput [(ngModel)]="f.firstNameKana" required></mat-form-field>
              <mat-form-field appearance="outline"><mat-label>生年月日</mat-label><input matInput [(ngModel)]="f.birthDate" required autocomplete="bday" [matDatepicker]="dp1" placeholder="YYYY/MM/DD"><mat-datepicker-toggle matIconSuffix [for]="dp1" /><mat-datepicker #dp1 startView="multi-year" /></mat-form-field>
              <mat-form-field appearance="outline"><mat-label>性別</mat-label>
                <mat-select [(ngModel)]="f.gender"><mat-option value="male">男</mat-option><mat-option value="female">女</mat-option></mat-select>
                <mat-hint>健康保険証などの記載に使います</mat-hint></mat-form-field>
            </div>
            <h2>住所と連絡先</h2>
            <div class="grid">
              <mat-form-field appearance="outline"><mat-label>郵便番号</mat-label><input matInput [(ngModel)]="f.postalCode" placeholder="123-4567" autocomplete="postal-code"></mat-form-field>
              <mat-form-field appearance="outline"><mat-label>都道府県</mat-label><input matInput [(ngModel)]="f.prefecture" autocomplete="address-level1"></mat-form-field>
              <mat-form-field appearance="outline"><mat-label>市区町村</mat-label><input matInput [(ngModel)]="f.city" autocomplete="address-level2"></mat-form-field>
              <mat-form-field appearance="outline"><mat-label>番地</mat-label><input matInput [(ngModel)]="f.addressLine" autocomplete="address-line1"></mat-form-field>
              <mat-form-field appearance="outline" class="wide"><mat-label>建物名・部屋番号</mat-label><input matInput [(ngModel)]="f.building" autocomplete="address-line2"></mat-form-field>
              <mat-form-field appearance="outline"><mat-label>電話番号</mat-label><input matInput [(ngModel)]="f.phone" placeholder="090-1234-5678" autocomplete="tel"></mat-form-field>
              <mat-form-field appearance="outline"><mat-label>メールアドレス</mat-label><input matInput type="email" [(ngModel)]="f.email" autocomplete="email"></mat-form-field>
            </div>
            <h2>扶養に入れたい家族</h2>
            <p class="hint">健康保険の扶養に入れたい家族（配偶者・子など）がいれば追加してください。収入などの確認は、あとで会社から案内します。</p>
            @for (d of f.dependents; track $index) {
              <div class="grid dependent">
                <mat-form-field appearance="outline"><mat-label>姓</mat-label><input matInput [(ngModel)]="d.lastName"></mat-form-field>
                <mat-form-field appearance="outline"><mat-label>名</mat-label><input matInput [(ngModel)]="d.firstName"></mat-form-field>
                <mat-form-field appearance="outline"><mat-label>続柄</mat-label>
                  <mat-select [(ngModel)]="d.relationship">
                    @for (r of relationshipKeys; track r) { <mat-option [value]="r">{{ relationships[r] }}</mat-option> }
                  </mat-select></mat-form-field>
                <mat-form-field appearance="outline"><mat-label>生年月日</mat-label><input matInput [(ngModel)]="d.birthDate" [matDatepicker]="dp2" placeholder="YYYY/MM/DD"><mat-datepicker-toggle matIconSuffix [for]="dp2" /><mat-datepicker #dp2 startView="multi-year" /></mat-form-field>
                <button mat-button type="button" class="remove" (click)="f.dependents.splice($index, 1)"><mat-icon>delete</mat-icon>この人を外す</button>
              </div>
            }
            <button mat-stroked-button type="button" (click)="addDependent()"><mat-icon>add</mat-icon>家族を追加</button>

            @if (problems().length) {
              <ul class="error" role="alert">@for (p of problems(); track p) { <li>{{ p }}</li> }</ul>
            }
            <div class="actions">
              <button mat-flat-button type="button" (click)="toConfirm()">入力内容を確認する</button>
            </div>
          </section>
        }
      }
    </main>
  `,
  styles: [`
    :host { display: block; min-height: 100vh; background: var(--app-color-surface-sub); }
    .page { max-width: 720px; margin: 0 auto; padding: var(--app-space-5) var(--app-space-4); box-sizing: border-box; }
    header { margin-bottom: var(--app-space-4); }
    .company { color: var(--app-color-text-sub); font-size: var(--app-font-sm); }
    h1 { font-size: var(--app-font-title); font-weight: 500; margin: var(--app-space-1) 0 var(--app-space-2); }
    h2 { font-size: var(--app-font-lg); font-weight: 500; margin: var(--app-space-4) 0 var(--app-space-2); }
    p { line-height: 1.8; margin: 0 0 var(--app-space-2); }
    .panel { padding: var(--app-space-5); background: var(--app-color-surface); border: 1px solid var(--app-color-border); border-radius: var(--app-radius); }
    .panel > h2:first-of-type { margin-top: 0; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 var(--app-space-3); }
    .grid .wide { grid-column: 1 / -1; }
    @media (max-width: 560px) { .grid { grid-template-columns: 1fr; } .panel { padding: var(--app-space-4); } }
    .dependent { padding: var(--app-space-3) var(--app-space-3) 0; margin-bottom: var(--app-space-2); background: var(--app-color-surface-sub); border-radius: var(--app-radius); }
    .remove { justify-self: start; margin-bottom: var(--app-space-2); }
    .hint { font-size: var(--app-font-sm); color: var(--app-color-text-sub); }
    .note { padding: var(--app-space-2) var(--app-space-3); background: var(--app-status-yours-bg); border-radius: var(--app-radius); }
    .error { color: var(--app-status-action-fg); }
    .actions { display: flex; justify-content: flex-end; gap: var(--app-space-2); margin-top: var(--app-space-4); }
    .done { display: flex; gap: var(--app-space-3); align-items: flex-start; background: var(--app-status-done-bg); border-color: transparent; }
    .done mat-icon { color: var(--app-status-done-fg); flex: none; }
    .confirm div { display: grid; grid-template-columns: 9em 1fr; gap: var(--app-space-2); padding: var(--app-space-2) 0; border-bottom: 1px solid var(--app-color-border); }
    .confirm dt { color: var(--app-color-text-sub); }
    .confirm dd { margin: 0; }
  `],
})
export class OnboardFormComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private functions = inject(Functions);

  readonly relationships = RELATIONSHIPS;
  readonly relationshipKeys = Object.keys(RELATIONSHIPS);
  private token = '';
  info = signal<InviteInfo | null>(null);
  loading = signal(true);
  loadError = signal('');
  stage = signal<'form' | 'confirm' | 'done'>('form');
  problems = signal<string[]>([]);
  sending = signal(false);
  submitError = signal('');
  f: SelfInput = {
    lastName: '', firstName: '', lastNameKana: '', firstNameKana: '', birthDate: '', gender: 'male',
    postalCode: null, prefecture: null, city: null, addressLine: null, building: null, phone: null, email: null, dependents: [],
  };

  async ngOnInit() {
    this.token = this.route.snapshot.paramMap.get('token') ?? '';
    try {
      const { data } = await httpsCallable<object, InviteInfo>(this.functions, 'onboardInviteGet')({ token: this.token });
      this.info.set(data);
      if (data.data) {
        this.f = structuredClone(data.data);
      } else {
        const [lastName = '', ...rest] = data.plannedName.split(/\s+/);
        this.f.lastName = lastName;
        this.f.firstName = rest.join(' ');
      }
    } catch (e) {
      this.loadError.set(errorMessage(e, 'リンクが正しいか確かめて、もう一度開いてください'));
    } finally {
      this.loading.set(false);
    }
  }

  addDependent() {
    this.f.dependents.push({ lastName: this.f.lastName, firstName: '', relationship: 'spouse', birthDate: null });
  }

  toConfirm() {
    const f = this.f;
    const problems: string[] = [];
    if (!f.lastName.trim() || !f.firstName.trim()) problems.push('氏名を入れてください');
    if (!KANA.test(f.lastNameKana) || !KANA.test(f.firstNameKana)) problems.push('フリガナはカタカナで入れてください');
    if (!f.birthDate) problems.push('生年月日を入れてください');
    if (f.postalCode && !/^\d{3}-?\d{4}$/.test(f.postalCode)) problems.push('郵便番号は「123-4567」の形で入れてください');
    if (f.phone && !/^[0-9-]{10,13}$/.test(f.phone)) problems.push('電話番号は数字とハイフンで入れてください');
    if (f.dependents.some(d => !d.lastName.trim() || !d.firstName.trim())) problems.push('家族の氏名を入れてください（いなければ「この人を外す」）');
    this.problems.set(problems);
    if (problems.length === 0) this.stage.set('confirm');
  }

  async send() {
    this.sending.set(true);
    this.submitError.set('');
    const blank = (s: string | null) => (s?.trim() ? s.trim() : null);
    const f = this.f;
    try {
      await httpsCallable(this.functions, 'onboardInviteSubmit')({
        token: this.token,
        data: {
          ...f,
          lastName: f.lastName.trim(), firstName: f.firstName.trim(), lastNameKana: f.lastNameKana.trim(), firstNameKana: f.firstNameKana.trim(),
          postalCode: blank(f.postalCode), prefecture: blank(f.prefecture), city: blank(f.city), addressLine: blank(f.addressLine),
          building: blank(f.building), phone: blank(f.phone), email: blank(f.email),
          dependents: f.dependents.map(d => ({ ...d, lastName: d.lastName.trim(), firstName: d.firstName.trim(), birthDate: d.birthDate || null })),
        },
      });
      this.stage.set('done');
    } catch (e) {
      this.submitError.set(errorMessage(e, '送信できませんでした。時間をおいてもう一度試してください'));
    } finally {
      this.sending.set(false);
    }
  }
}
