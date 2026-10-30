import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../core/services/auth.service';
import { OfficeContextService } from '../../core/services/office-context.service';
import { LIFE_EVENTS, LifeEvent, LifeEventCardsComponent } from './life-events';

interface Employee { id: string; lastName: string; firstName: string; employeeNumber: string }

/** 手続きを始める。何が起きたかをカードで選び、従業員を選ぶ業務ならその人を選んで進む */
@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatRadioModule, LifeEventCardsComponent],
  template: `<section class="start">
    <h1>手続きを始める</h1>
    <p class="lead">何が起きたかを選んでください。必要な入力画面へ案内します。</p>
    <app-life-event-cards [selected]="type()" [handlesPick]="true" (pick)="pick($event)" />

    @if (event(); as e) {
      <section class="employee" aria-labelledby="employee-heading">
        <h2 id="employee-heading">「{{e.label}}」の対象の従業員を選ぶ</h2>
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
        <p class="note">この画面では従業員の情報を変更しません。次の画面で入力・確認してから登録します。</p>
        <button mat-flat-button (click)="start()" [disabled]="!canStart() || starting()">入力画面へ進む</button>
      </section>
    }
  </section>`,
  styles: [`
    .start { max-width: 960px; margin: 0 auto; padding: var(--app-space-5); }
    h1 { margin: 0 0 var(--app-space-2); font-size: var(--app-font-title); font-weight: 500; }
    .lead { margin: 0 0 var(--app-space-5); color: var(--app-color-text-sub); }
    .employee { margin-top: var(--app-space-5); padding: var(--app-space-5); border: 1px solid var(--app-color-border); border-radius: var(--app-radius); background: var(--app-color-surface); }
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
  employeeId = ''; keyword = ''; leaveKind: 'maternity' | 'childcare' = 'maternity';
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
  }

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
    if (this.type() === 'monthly_change') { void this.router.navigate(['/employees', this.employeeId, 'revision']); return; }
    // ウィザードで進める業務。同じ人の進行中の手続きがあれば、それを開く
    const wizard: Record<string, { fn: string; route: string }> = {
      loss: { fn: 'resignationStart', route: '/resignation' },
      dependent_change: { fn: 'dependentChangeStart', route: '/dependents' },
      leave: { fn: 'leaveProcedureStart', route: '/leaves' },
    };
    const w = wizard[this.type()];
    if (w) {
      this.starting.set(true); this.error.set('');
      try {
        const {data} = await httpsCallable<object,{procedureId:string}>(this.functions,w.fn)({companyId:this.auth.companyId,employeeId:this.employeeId,...(this.type() === 'leave' ? {kind:this.leaveKind} : {})});
        void this.router.navigate([w.route, data.procedureId]);
      } catch(e:any) { this.error.set(e.message ?? '手続きを始められませんでした'); } finally { this.starting.set(false); }
      return;
    }
    void this.router.navigate(['/employees', this.employeeId], { queryParams: { action: this.type() } });
  }
}
