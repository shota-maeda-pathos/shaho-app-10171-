import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../core/services/auth.service';
import { OfficeContextService } from '../../core/services/office-context.service';

interface Employee { id: string; lastName: string; firstName: string; employeeNumber: string }
@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatSelectModule, MatInputModule],
  template: `<section class="start"><a routerLink="/procedures">手続き一覧に戻る</a><h1>手続きを始める</h1>
    <p>行う業務を選んでください。必要な入力画面へ案内します。</p>
    <mat-form-field appearance="outline"><mat-label>行う業務</mat-label><mat-select [(ngModel)]="type">
      @for (item of types; track item.id) { <mat-option [value]="item.id">{{item.label}}</mat-option> }
    </mat-select></mat-form-field>
    @if (!['acquisition','annual_review','bonus_payment'].includes(type)) {
      <mat-form-field appearance="outline"><mat-label>従業員を検索</mat-label><input matInput [(ngModel)]="keyword"></mat-form-field>
      <mat-form-field appearance="outline"><mat-label>対象従業員</mat-label><mat-select [(ngModel)]="employeeId">
        @for (employee of matches(); track employee.id) { <mat-option [value]="employee.id">{{employee.employeeNumber}} — {{employee.lastName}} {{employee.firstName}}</mat-option> }
      </mat-select></mat-form-field>
      @if (loading()) { <p>従業員を読み込んでいます…</p> }
      @if (hasMore()) { <button mat-stroked-button (click)="loadEmployees()" [disabled]="loading()">従業員をさらに読み込む</button> }
    }
    @if (error()) { <p role="alert">{{error()}}</p><button mat-stroked-button (click)="loadEmployees()">再読み込み</button> }
    <p>入力・確認後に登録を実行します。この画面では従業員情報を変更しません。</p>
    <button mat-flat-button (click)="start()" [disabled]="!canStart()">入力画面へ進む</button>
  </section>`,
  styles: [`.start{max-width:760px;margin:24px auto;padding:24px}.start mat-form-field{display:block;width:100%;margin:12px 0}.start p{line-height:1.7}`],
})
export class ProcedureStartComponent implements OnInit {
  office = inject(OfficeContextService);
  private functions = inject(Functions); private auth = inject(AuthService); private router = inject(Router); private route = inject(ActivatedRoute);
  type = 'acquisition'; employeeId = ''; keyword = ''; employees = signal<Employee[]>([]); loading = signal(false); error = signal(''); hasMore = signal(true); private cursor = '';
  types = [{id:'acquisition',label:'入社'}, {id:'loss',label:'退職'}, {id:'transfer',label:'事業所間異動'}, {id:'dependent_change',label:'扶養家族の追加・変更'}, {id:'leave',label:'休業の登録・変更'}, {id:'monthly_change',label:'随時改定'}, {id:'annual_review',label:'算定基礎'}, {id:'bonus_payment',label:'賞与'}];
  ngOnInit() { const params = this.route.snapshot.queryParamMap; const requested = params.get('type'); if (this.types.some(t => t.id === requested)) this.type = requested!; this.employeeId = params.get('employeeId') ?? ''; void this.loadEmployees(); }
  matches() { const term = this.keyword.replace(/\s/g,''); return this.employees().filter(e => `${e.employeeNumber}${e.lastName}${e.firstName}`.includes(term)); }
  canStart() { return ['acquisition','annual_review','bonus_payment'].includes(this.type) || this.employees().some(e => e.id === this.employeeId); }
  async loadEmployees() {
    if (this.loading()) return; this.loading.set(true); this.error.set('');
    try {
      const {data} = await httpsCallable<object,{items:Employee[];hasMore:boolean;lastDocId?:string}>(this.functions,'employeeList')({companyId:this.auth.companyId,...this.office.params(),limit:100,...(this.cursor ? {lastDocId:this.cursor}: {})});
      this.employees.update(rows => [...rows,...data.items]); this.hasMore.set(data.hasMore); this.cursor = data.lastDocId ?? data.items.at(-1)?.id ?? this.cursor;
    } catch(e:any) { this.error.set(e.message ?? '従業員を取得できませんでした'); } finally { this.loading.set(false); }
  }
  start() {
    if (!this.canStart()) return;
    if (this.type === 'acquisition') { void this.router.navigate(['/onboarding/new']); return; }
    if (this.type === 'annual_review') { void this.router.navigate(['/santei']); return; }
    if (this.type === 'bonus_payment') { void this.router.navigate(['/premium/bonus']); return; }
    if (this.type === 'monthly_change') { void this.router.navigate(['/employees', this.employeeId, 'revision']); return; }
    void this.router.navigate(['/employees',this.employeeId],{queryParams:{action:this.type}});
  }
}
