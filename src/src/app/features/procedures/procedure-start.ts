import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { MatIconModule } from '@angular/material/icon';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../core/services/auth.service';
import { OfficeContextService } from '../../core/services/office-context.service';
import { LIFE_EVENTS, LifeEvent, LifeEventCardsComponent } from './life-events';

interface Employee { id: string; lastName: string; firstName: string; employeeNumber: string }

/** 手続きを始める。①何が起きたかをカードで選び、②従業員を選ぶ業務ならカードの一覧をその人を選ぶ画面に切り替えて進む */
@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatRadioModule, MatIconModule, LifeEventCardsComponent],
  template: `<section class="start">
    <h1>手続きを始める</h1>
    <ol class="steps" aria-label="手順">
      <li [class.on]="!event()" [class.done]="!!event()">@if (event()) { <mat-icon aria-hidden="true">check</mat-icon> }1 何が起きたか</li>
      <li [class.on]="!!event()">2 だれの手続きか</li>
    </ol>

    @if (!event()) {
      <p class="lead">何が起きたかを選んでください。必要な入力画面へ案内します。</p>
      <app-life-event-cards [selected]="type()" [handlesPick]="true" (pick)="pick($event)" />
    } @else {
      @let e = event()!;
      <div class="chosen">
        <mat-icon aria-hidden="true">{{ e.icon }}</mat-icon>
        <div><b>{{ e.label }}</b><span>{{ e.hint }}</span></div>
        <button mat-button type="button" (click)="reset()">変更する</button>
      </div>
      <section class="employee" aria-labelledby="employee-heading">
        <h2 id="employee-heading">対象の従業員を選ぶ</h2>
        <mat-form-field appearance="outline"><mat-label>社員番号・氏名で探す</mat-label><input matInput [(ngModel)]="keyword" (ngModelChange)="employeeId = ''"></mat-form-field>
        @if (loading()) { <p role="status">従業員を読み込んでいます…</p> }
        <ul class="matches" role="listbox" aria-label="対象の従業員">
          @for (employee of matches(); track employee.id) {
            <li><button type="button" role="option" [attr.aria-selected]="employeeId === employee.id" [class.selected]="employeeId === employee.id" (click)="employeeId = employee.id">{{employee.employeeNumber}}　{{employee.lastName}} {{employee.firstName}}</button></li>
          }
        </ul>
        @if (!loading() && keyword && !matches().length) { <p>見つかりません。{{hasMore() ? '続きを読み込んでから探してください。' : ''}}</p> }
        @if (hasMore()) { <button mat-stroked-button (click)="loadEmployees()" [disabled]="loading()">従業員をさらに読み込む</button> }
        @if (error()) { <p role="alert">{{error()}}</p><button mat-stroked-button (click)="loadEmployees()">再読み込み</button> }
        @if (type() === 'leave') {
          <h3>休業の種類</h3>
          <mat-radio-group [(ngModel)]="leaveKind" class="kinds" aria-label="休業の種類">
            <mat-radio-button value="maternity">産休（産前産後休業。出産する本人）</mat-radio-button>
            <mat-radio-button value="childcare">育休（育児休業。父母どちらでも）</mat-radio-button>
          </mat-radio-group>
          <p class="note">休業中の出産・延長・復帰も、始めた手続きの中で記録します。進行中の手続きがあれば、それを開きます。</p>
        }
        @if (type() === 'monthly_change') {
          <h3>見直しのきっかけ</h3>
          <mat-radio-group [(ngModel)]="revisionKind" class="kinds" aria-label="見直しのきっかけ">
            <mat-radio-button value="occasional">昇給・降給などで固定的賃金が変わった（随時改定）</mat-radio-button>
            <mat-radio-button value="childcareEnd">育休から復帰して給与が変わった（育休終了時の改定）</mat-radio-button>
            <mat-radio-button value="maternityEnd">産休から復帰して給与が変わった（産休終了時の改定）</mat-radio-button>
          </mat-radio-group>
          <p class="note">産休・育休の手続きをこのシステムで行った場合は、その手続きの完了画面から始めると、休業を終えた日を引き継げます。</p>
        }
        @if (type() === 'age_event') {
          <h3>年齢</h3>
          <mat-radio-group [(ngModel)]="ageKind" class="kinds" aria-label="到達する年齢">
            <mat-radio-button value="pension70">70歳（厚生年金の資格を失う）</mat-radio-button>
            <mat-radio-button value="health75">75歳（健康保険の資格を失う）</mat-radio-button>
          </mat-radio-group>
          <p class="note">40歳・65歳は届出がなく、介護保険料は毎月の計算で自動で変わります。ホームの「やること」に事前に出ます。</p>
        }
        <p class="note">この画面では従業員の情報を変更しません。次の画面で入力・確認してから登録します。</p>
        <div class="actions">
          <button mat-button type="button" (click)="reset()"><mat-icon>arrow_back</mat-icon>手続きを選び直す</button>
          <button mat-flat-button (click)="start()" [disabled]="!canStart() || starting()">入力画面へ進む</button>
        </div>
      </section>
    }
  </section>`,
  styles: [`
    .start { max-width: 960px; margin: 0 auto; padding: var(--app-space-5); }
    h1 { margin: 0 0 var(--app-space-2); font-size: var(--app-font-title); font-weight: 500; }
    .lead { margin: 0 0 var(--app-space-5); color: var(--app-color-text-sub); }
    .steps { display: flex; gap: var(--app-space-2); list-style: none; margin: 0 0 var(--app-space-4); padding: 0; font-size: var(--app-font-sm); color: var(--app-color-text-sub); }
    .steps li { display: inline-flex; align-items: center; gap: 4px; padding: 2px 10px; border-radius: 999px; }
    .steps li + li::before { content: '→'; margin-right: var(--app-space-2); color: var(--app-color-text-sub); }
    .steps li.on { background: var(--app-status-yours-bg); color: var(--app-status-yours-fg); font-weight: 600; }
    .steps li.done { color: var(--app-status-done-fg); }
    .steps mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .chosen { display: flex; align-items: center; gap: var(--app-space-3); padding: var(--app-space-3) var(--app-space-4); border: 1px solid var(--app-color-border); border-radius: var(--app-radius); background: var(--app-color-surface); }
    .chosen > mat-icon { color: var(--app-color-link); font-size: 28px; width: 28px; height: 28px; }
    .chosen > div { flex: 1; display: flex; flex-direction: column; }
    .chosen b { font-size: var(--app-font-lg); font-weight: 600; }
    .chosen span { font-size: var(--app-font-sm); color: var(--app-color-text-sub); }
    .actions { display: flex; justify-content: space-between; align-items: center; gap: var(--app-space-3); margin-top: var(--app-space-4); }
    .employee { margin-top: var(--app-space-4); padding: var(--app-space-5); border: 1px solid var(--app-color-border); border-radius: var(--app-radius); background: var(--app-color-surface); }
    .employee h2 { margin: 0 0 var(--app-space-4); font-size: var(--app-font-lg); }
    .employee mat-form-field { display: block; max-width: 420px; }
    .matches { list-style: none; margin: 0 0 var(--app-space-3); padding: 0; max-height: 280px; overflow-y: auto; border: 1px solid var(--app-color-border); border-radius: var(--app-radius); }
    .matches:empty { display: none; }
    .matches button { display: block; width: 100%; padding: var(--app-space-3) var(--app-space-4); border: 0; border-bottom: 1px solid var(--app-color-border); background: transparent; font: inherit; text-align: left; cursor: pointer; }
    .matches li:last-child button { border-bottom: 0; }
    .matches button:hover { background: var(--app-color-surface-sub); }
    .matches button.selected { background: var(--app-status-yours-bg); color: var(--app-status-yours-fg); font-weight: 600; }
    .note { color: var(--app-color-text-sub); font-size: var(--app-font-sm); }
    .employee h3 { margin: var(--app-space-4) 0 var(--app-space-2); font-size: var(--app-font-md, 1rem); font-weight: 500; }
    .kinds { display: flex; flex-direction: column; gap: var(--app-space-1); }
  `],
})
export class ProcedureStartComponent implements OnInit {
  office = inject(OfficeContextService);
  private functions = inject(Functions); private auth = inject(AuthService); private router = inject(Router); private route = inject(ActivatedRoute);
  type = signal('');
  event = computed(() => LIFE_EVENTS.find(e => e.type === this.type() && !e.route) ?? null);
  employeeId = ''; keyword = ''; leaveKind: 'maternity' | 'childcare' = 'maternity'; revisionKind: 'occasional' | 'maternityEnd' | 'childcareEnd' = 'occasional'; ageKind: 'pension70' | 'health75' = 'pension70';
  employees = signal<Employee[]>([]); loading = signal(false); error = signal(''); hasMore = signal(true); private cursor = '';
  starting = signal(false);

  ngOnInit() {
    const params = this.route.snapshot.queryParamMap;
    const requested = params.get('type') ?? '';
    if (LIFE_EVENTS.some(e => e.type === requested && !e.route)) this.type.set(requested);
    this.employeeId = params.get('employeeId') ?? '';
    if (this.event()) void this.loadEmployees();
  }

  pick(event: LifeEvent) {
    this.type.set(event.type);
    void this.router.navigate([], { queryParams: { type: event.type }, queryParamsHandling: 'merge', replaceUrl: true });
    if (!this.employees().length) void this.loadEmployees();
    this.scrollTop();
  }

  /** ①に戻って手続きを選び直す */
  reset() {
    this.type.set(''); this.employeeId = ''; this.keyword = ''; this.error.set('');
    void this.router.navigate([], { queryParams: { type: null, employeeId: null }, queryParamsHandling: 'merge', replaceUrl: true });
    this.scrollTop();
  }

  /** 切り替えた画面を上から見せる（画面の本文は .content の中でスクロールする） */
  private scrollTop() { document.querySelector('.content')?.scrollTo({ top: 0 }); }

  matches() {
    const term = this.keyword.replace(/\s/g, '');
    const rows = this.employees().filter(e => `${e.employeeNumber}${e.lastName}${e.firstName}`.includes(term));
    return term ? rows : rows.slice(0, 50);
  }
  canStart() { return !!this.event() && this.employees().some(e => e.id === this.employeeId); }

  async loadEmployees() {
    if (this.loading()) return; this.loading.set(true); this.error.set('');
    try {
      const {data} = await httpsCallable<object,{items:Employee[];hasMore:boolean;lastDocId?:string}>(this.functions,'employeeList')({companyId:this.auth.companyId,...this.office.params(),limit:100,...(this.cursor ? {lastDocId:this.cursor}: {})});
      this.employees.update(rows => [...rows,...data.items]); this.hasMore.set(data.hasMore); this.cursor = data.lastDocId ?? data.items.at(-1)?.id ?? this.cursor;
    } catch(e:any) { this.error.set(e.message ?? '従業員を取得できませんでした'); } finally { this.loading.set(false); }
  }

  async start() {
    if (!this.canStart()) return;
    // ウィザードで進める業務。同じ人の進行中の手続きがあれば、それを開く
    const wizard: Record<string, { fn: string; route: string }> = {
      loss: { fn: 'resignationStart', route: '/resignation' },
      dependent_change: { fn: 'dependentChangeStart', route: '/dependents' },
      leave: { fn: 'leaveProcedureStart', route: '/leaves' },
      monthly_change: { fn: 'gradeRevisionStart', route: '/revisions' },
      age_event: { fn: 'ageEventStart', route: '/age-events' },
      transfer: { fn: 'transferStart', route: '/transfers' },
    };
    const w = wizard[this.type()];
    if (w) {
      this.starting.set(true); this.error.set('');
      try {
        const {data} = await httpsCallable<object,{procedureId:string}>(this.functions,w.fn)({companyId:this.auth.companyId,employeeId:this.employeeId,...(this.type() === 'leave' ? {kind:this.leaveKind} : this.type() === 'monthly_change' ? {kind:this.revisionKind} : this.type() === 'age_event' ? {kind:this.ageKind} : {})});
        void this.router.navigate([w.route, data.procedureId]);
      } catch(e:any) { this.error.set(e.message ?? '手続きを始められませんでした'); } finally { this.starting.set(false); }
      return;
    }
    void this.router.navigate(['/employees', this.employeeId], { queryParams: { action: this.type() } });
  }
}
