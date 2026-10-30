import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { MatSelectModule } from '@angular/material/select';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../core/services/auth.service';
import { OfficeContextService } from '../../core/services/office-context.service';
import { TermComponent } from '../../shared/ui';
import { errorMessage } from './onboarding.types';

interface Person { lastName: string; firstName: string; email: string | null }

/** 「人が入社する」の入口。1人でも、新卒一斉入社のようにまとめてでも始められる */
@Component({
  selector: 'app-onboarding-start',
  standalone: true,
  imports: [
    FormsModule, RouterLink, MatButtonModule, MatButtonToggleModule, MatFormFieldModule, MatIconModule,
    MatInputModule, MatRadioModule, MatSelectModule, TermComponent,
  ],
  template: `
    <div class="app-page narrow">
      <a routerLink="/onboarding" class="back"><mat-icon>arrow_back</mat-icon>入社手続きの一覧</a>
      <h1 class="app-page-title">人が入社する</h1>
      <p class="app-page-guide">
        入社する人の名前と入社日を入れて始めます。このあと、本人に住所などを入力してもらい、雇用条件を入れると、
        社会保険に加入するかをシステムが判定し、<app-term key="acquisitionFiling" />を作ります。
      </p>

      <section class="block">
        <h2>何人が入社しますか</h2>
        <mat-button-toggle-group [value]="mode()" (change)="mode.set($event.value)" aria-label="人数">
          <mat-button-toggle value="single">1人</mat-button-toggle>
          <mat-button-toggle value="bulk">まとめて（新卒の一斉入社など）</mat-button-toggle>
        </mat-button-toggle-group>
      </section>

      <section class="block grid">
        <mat-form-field appearance="outline">
          <mat-label>事業所</mat-label>
          <mat-select [(ngModel)]="officeId" required>
            @for (o of office.offices(); track o.id) { <mat-option [value]="o.id">{{ o.name }}</mat-option> }
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>入社日（資格取得日）</mat-label>
          <input matInput type="date" [(ngModel)]="hireDate" required>
          <mat-hint>資格取得届はこの日の5日後までに出します</mat-hint>
        </mat-form-field>
      </section>

      @if (mode() === 'single') {
        <section class="block grid">
          <mat-form-field appearance="outline"><mat-label>姓</mat-label><input matInput [(ngModel)]="lastName" required></mat-form-field>
          <mat-form-field appearance="outline"><mat-label>名</mat-label><input matInput [(ngModel)]="firstName" required></mat-form-field>
          <mat-form-field appearance="outline" class="wide">
            <mat-label>本人のメールアドレス（任意）</mat-label>
            <input matInput type="email" [(ngModel)]="email">
            <mat-hint>入力用のリンクを送る先の控えです。メールは自動では送りません</mat-hint>
          </mat-form-field>
        </section>
      } @else {
        <section class="block">
          <mat-form-field appearance="outline" class="full">
            <mat-label>入社する人（1行に1人）</mat-label>
            <textarea matInput rows="8" [ngModel]="bulkText()" (ngModelChange)="bulkText.set($event)"
                      placeholder="例：&#10;山田 太郎 taro@example.com&#10;佐藤 花子"></textarea>
            <mat-hint>「姓 名」の順に、空白で区切って入れます。メールアドレスは任意です。表計算ソフトから貼り付けても使えます</mat-hint>
          </mat-form-field>
          <p class="count">
            {{ people().length }}名
            @if (bulkErrors().length) { <span class="error">／読み取れない行：{{ bulkErrors().join('、') }}行目</span> }
          </p>
        </section>
      }

      <section class="block">
        <h2>住所などの入力</h2>
        <mat-radio-group [(ngModel)]="inviteMode" class="radios">
          <mat-radio-button value="invite">本人に入力してもらう（おすすめ）
            <div class="hint">入力用のリンクを作ります。本人がスマートフォンなどで入力します</div>
          </mat-radio-button>
          <mat-radio-button value="staff">担当者が代わりに入力する
            <div class="hint">本人から書類で受け取った場合など</div>
          </mat-radio-button>
        </mat-radio-group>
      </section>

      @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
      <div class="actions">
        <button mat-flat-button type="button" (click)="start()" [disabled]="!canStart() || busy()">
          {{ busy() ? '準備しています…' : (mode() === 'single' ? '入社手続きを始める' : people().length + '名の入社手続きを始める') }}
        </button>
      </div>
    </div>
  `,
  styles: [`
    .narrow { max-width: 760px; }
    .back { display: inline-flex; align-items: center; gap: var(--app-space-1); color: var(--app-color-link); text-decoration: none; margin-bottom: var(--app-space-3); }
    .block { margin-bottom: var(--app-space-4); }
    .block h2 { font-size: var(--app-font-lg); font-weight: 500; margin: 0 0 var(--app-space-2); }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 var(--app-space-4); }
    .grid .wide { grid-column: 1 / -1; }
    @media (max-width: 600px) { .grid { grid-template-columns: 1fr; } }
    .full { width: 100%; }
    .count { margin: 0; color: var(--app-color-text-sub); }
    .radios { display: flex; flex-direction: column; gap: var(--app-space-2); }
    .hint { font-size: var(--app-font-sm); color: var(--app-color-text-sub); }
    .error { color: var(--app-status-action-fg); }
    .actions { display: flex; justify-content: flex-end; }
  `],
})
export class OnboardingStartComponent {
  office = inject(OfficeContextService);
  private functions = inject(Functions);
  private auth = inject(AuthService);
  private router = inject(Router);
  private query = inject(ActivatedRoute).snapshot.queryParamMap;

  mode = signal<'single' | 'bulk'>('single');
  // まとめの画面の「この日に入社する人を追加」から来たときは、事業所と入社日を引き継ぐ
  officeId = this.query.get('officeId') || this.office.selected() || (this.office.offices().length === 1 ? this.office.offices()[0].id : '');
  hireDate = this.query.get('hireDate') ?? '';
  lastName = '';
  firstName = '';
  email = '';
  inviteMode: 'invite' | 'staff' = 'invite';
  bulkText = signal('');
  busy = signal(false);
  error = signal('');

  private parsed = computed(() => {
    const people: Person[] = [];
    const errors: number[] = [];
    this.bulkText().split(/\r?\n/).forEach((line, i) => {
      const cells = line.split(/[\s,\t、]+/).map(c => c.trim()).filter(Boolean);
      if (cells.length === 0) return;
      const email = cells.find(c => c.includes('@')) ?? null;
      const names = cells.filter(c => c !== email);
      if (names.length < 2) { errors.push(i + 1); return; }
      people.push({ lastName: names[0], firstName: names.slice(1).join(' '), email });
    });
    return { people, errors };
  });
  people = computed(() => this.parsed().people);
  bulkErrors = computed(() => this.parsed().errors);

  canStart() {
    if (!this.officeId || !this.hireDate) return false;
    if (this.mode() === 'single') return !!this.lastName.trim() && !!this.firstName.trim();
    return this.people().length > 0 && this.bulkErrors().length === 0;
  }

  async start() {
    this.busy.set(true);
    this.error.set('');
    const people = this.mode() === 'single'
      ? [{ lastName: this.lastName.trim(), firstName: this.firstName.trim(), email: this.email.trim() || null }]
      : this.people();
    try {
      const { data } = await httpsCallable<object, { batchId: string | null; items: { procedureId: string }[] }>(this.functions, 'onboardingStart')({
        companyId: this.auth.companyId, officeId: this.officeId, hireDate: this.hireDate, people, skipInvite: this.inviteMode === 'staff',
      });
      // 1名だけでも、事業所×入社日のまとめの画面を通る（docs/ui-unification-design.md の3章）
      await this.router.navigate(['/onboarding'], { queryParams: { officeId: this.officeId, key: this.hireDate } });
    } catch (e) {
      this.error.set(errorMessage(e, '入社手続きを始められませんでした'));
    } finally {
      this.busy.set(false);
    }
  }
}
