import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../core/services/auth.service';
import { OfficeContextService } from '../../core/services/office-context.service';

interface Row {employeeId:string;employeeNumber:string;employeeName:string;included:boolean;issues:string[];held:boolean;holdReason:string;holdVersion:number;salaryExists:boolean;salaryConfirmed:boolean;published:boolean;calculated:boolean;insuranceConfirmed:boolean;approvalPending:boolean;totalEmployee:number|null;totalEmployer:number|null}
interface Run {id:string;action:string;status:string;updatedAt:string|null;result:{results:{employeeId:string;success:boolean;message:string}[]}|null}
@Component({standalone:true,imports:[CommonModule,FormsModule,RouterLink,MatButtonModule],template:`
  <section class="operations"><h1>定例業務</h1>
    @if(!office.selected()) {
      <p>月次業務を進める事業所を選択してください。</p>
      @for(item of office.offices();track item.id) {<button mat-stroked-button (click)="office.change(item.id)">{{item.name}}</button>}
    } @else {
      <div class="period"><h2>{{office.label()}}の月次業務</h2><label>保険料の対象月 <input type="month" [ngModel]="yearMonth" (ngModelChange)="changeMonth($event)" [disabled]="running()"></label><button mat-stroked-button (click)="load()" [disabled]="loading()||running()">最新の状況に更新</button></div>
      <p>給与・等級を確認して計算し、別担当者の承認後に明細を公開します。徴収記録の準備と、実際の回収完了は別に管理します。</p>
      @if(error()) {<p role="alert">{{error()}}</p>}
      <div class="progress" aria-label="表示中の対象者の進捗">
        <div>対象者<strong>{{included().length}}名</strong></div><div>給与承認済み<strong>{{count('salaryConfirmed')}}名</strong></div><div>保険料承認済み<strong>{{count('insuranceConfirmed')}}名</strong></div><div>明細公開済み<strong>{{count('published')}}名</strong></div><div>保留<strong>{{count('held')}}名</strong></div>
      </div><p class="caption">進捗人数は現在表示している対象者の集計です。{{hasMore() ? '続きの対象者があります。' : ''}}</p>
      <div class="actions"><a mat-stroked-button routerLink="/salary" [queryParams]="query()">1. 給与入力・承認申請</a>
        <button mat-flat-button (click)="run('calculate')" [disabled]="!selected().size||running()||loading()">2. 選択した対象者を計算</button>
        <button mat-stroked-button (click)="run('requestApproval')" [disabled]="!selected().size||running()||loading()">3. 保険料の承認を申請</button>
        <a mat-stroked-button routerLink="/approvals" [queryParams]="query()">承認状況・差戻しを確認</a>
        <button mat-stroked-button (click)="run('publish')" [disabled]="!selected().size||running()||loading()">4. 選択した明細を公開</button>
      </div>
      @if(running()) {<p role="status">処理中です。結果を確認するまでお待ちください。</p>}
      @if(loading()) {<p role="status">対象者の状況を読み込んでいます…</p>}
      <div class="table-wrap"><table><thead><tr><th><input type="checkbox" aria-label="表示中の対象者を選択" [checked]="allSelected()" (change)="selectAll($any($event.target).checked)" [disabled]="running()"></th><th>従業員</th><th>給与</th><th>保険料</th><th>本人負担</th><th>会社負担</th><th>公開</th><th>不足情報・保留</th></tr></thead><tbody>
        @for(row of rows();track row.employeeId) {<tr [class.excluded]="!row.included">
          <td><input type="checkbox" [attr.aria-label]="row.employeeName+'を選択'" [checked]="selected().has(row.employeeId)" (change)="select(row.employeeId,$any($event.target).checked)" [disabled]="!row.included||row.held||running()"></td>
          <td><a [routerLink]="['/employees',row.employeeId]" [queryParams]="query()">{{row.employeeName}}</a><small>{{row.employeeNumber}}</small></td>
          <td><a [routerLink]="['/salary',row.employeeId]" [queryParams]="query()">{{row.salaryConfirmed?'承認済み':row.salaryExists?'未承認':'未登録'}}</a></td>
          <td>{{row.insuranceConfirmed?'承認済み':row.approvalPending?'承認待ち':row.calculated?'計算済み':'未計算'}}</td>
          <td>{{row.totalEmployee===null?'—':(row.totalEmployee|number)+' 円'}}</td><td>{{row.totalEmployer===null?'—':(row.totalEmployer|number)+' 円'}}</td>
          <td>{{row.published?'公開済み':'未公開'}}</td><td>
            @if(!row.included) {対象期間外}
            @for(issue of row.issues;track issue) {<div class="issue">{{issue}}</div>}
            @if(row.held) {<div>保留：{{row.holdReason}}</div>}
            @if(row.included) {<button mat-button (click)="hold(row)" [disabled]="running()">{{row.held?'保留を解除':'理由を付けて保留'}}</button>}
          </td></tr>}
      </tbody></table></div>
      @if(!loading()&&!rows().length&&!error()) {<p>この事業所の従業員は登録されていません。</p>}
      @if(hasMore()) {<button mat-stroked-button (click)="load(true)" [disabled]="loading()||running()">対象者をさらに読み込む</button>}
      @for(result of results();track result.employeeId) {<p [class.issue]="!result.success" role="status">{{name(result.employeeId)}}：{{result.message}}</p>}
      @if(recentRuns().length) {<section><h2>最近の処理履歴</h2>@for(run of recentRuns();track run.id) {<p>{{actionLabel(run.action)}} — {{run.status==='completed'?'処理終了':'処理中'}} {{run.updatedAt|date:'yyyy/MM/dd HH:mm'}} @if(run.result) {<button mat-button (click)="results.set(run.result.results)">対象者別の結果を確認</button>}</p>}</section>}
      <section class="collection"><h2>徴収・控除の確認</h2><p>保険料の承認後、事業所の徴収記録を準備できます。明細公開は回収完了を待つ必要はありません。</p>
        <button mat-stroked-button (click)="prepareCollection()" [disabled]="running()||loading()||hasMore()||!count('insuranceConfirmed')">事業所の徴収記録を準備</button>
        <a mat-stroked-button routerLink="/premium/collection" [queryParams]="query()">徴収集計を確認</a>
      </section>
    }
    <section class="annual"><h2>賞与・年次業務</h2><a mat-stroked-button routerLink="/premium/bonus" [queryParams]="query()">賞与保険料</a><a mat-stroked-button routerLink="/santei" [queryParams]="query()">算定基礎届</a><a mat-stroked-button routerLink="/procedures" [queryParams]="query()">関連手続きを確認</a></section>
  </section>`,styles:[`.operations{padding:24px}.period,.actions{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.period h2{margin-right:auto}.period input{padding:8px}.progress{display:flex;gap:24px;flex-wrap:wrap;padding:20px 0}.progress strong{display:block;font-size:23px;margin-top:8px}.caption,small{font-size:13px;color:#555}small{display:block}.table-wrap{overflow:auto;margin:24px 0}table{border-collapse:collapse;width:100%;min-width:900px}th,td{padding:12px;text-align:left;border-bottom:1px solid #ddd;vertical-align:top}th{background:#f4f6f8}.issue{color:#a92818}.excluded{color:#666}.collection,.annual{border-top:1px solid #ddd;padding:20px 0;margin-top:24px}a,button{margin:4px}.annual a{margin-right:12px}`]})
export class OperationsComponent implements OnInit {
  office=inject(OfficeContextService);private auth=inject(AuthService);private functions=inject(Functions);private route=inject(ActivatedRoute);private router=inject(Router);
  yearMonth=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'}).slice(0,7);
  rows=signal<Row[]>([]);selected=signal(new Set<string>());loading=signal(false);running=signal(false);error=signal('');hasMore=signal(false);private cursor='';private sequence=0;
  results=signal<{employeeId:string;success:boolean;message:string}[]>([]);
  recentRuns=signal<Run[]>([]);
  actionLabel(action:string){return ({calculate:'保険料計算',requestApproval:'承認申請',publish:'明細公開',createCollection:'徴収記録の準備'} as Record<string,string>)[action]??action;}
  ngOnInit(){const month=this.route.snapshot.queryParamMap.get('yearMonth');if(month&&/^\d{4}-(0[1-9]|1[0-2])$/.test(month))this.yearMonth=month;void this.load();}
  query(){return {...this.office.queryParams(),yearMonth:this.yearMonth};}
  included(){return this.rows().filter(r=>r.included);}
  count(key:'salaryConfirmed'|'insuranceConfirmed'|'published'|'held'){return this.included().filter(r=>r[key]).length;}
  name(id:string){return this.rows().find(r=>r.employeeId===id)?.employeeName??id;}
  allSelected(){const available=this.included().filter(r=>!r.held);return available.length>0&&available.every(r=>this.selected().has(r.employeeId));}
  select(id:string,value:boolean){if(value&&this.selected().size>=100){this.error.set('一度に処理できるのは100名までです');return;}this.selected.update(previous=>{const next=new Set(previous);if(value)next.add(id);else next.delete(id);return next;});}
  selectAll(value:boolean){this.selected.set(new Set(value?this.included().filter(r=>!r.held).slice(0,100).map(r=>r.employeeId):[]));if(value&&this.included().length>100)this.error.set('先頭の100名を選択しました。残りは処理後に選択してください。');}
  async changeMonth(value:string){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(value))return;this.yearMonth=value;this.results.set([]);await this.router.navigate([],{queryParams:{yearMonth:value},queryParamsHandling:'merge'});await this.load();}
  async load(append=false){
    if(!this.office.selected())return;const sequence=++this.sequence;this.loading.set(true);this.error.set('');
    if(!append){this.cursor='';this.rows.set([]);this.selected.set(new Set());this.hasMore.set(false);}
    try{const {data}=await httpsCallable<object,{items:Row[];hasMore:boolean;cursor:string|null;recentRuns:Run[]}>(this.functions,'operationsMonthlyStatus')({companyId:this.auth.companyId,officeId:this.office.selected(),yearMonth:this.yearMonth,limit:50,...(append&&this.cursor?{cursor:this.cursor}:{})});
      if(sequence!==this.sequence)return;this.rows.update(rows=>[...rows,...data.items]);this.hasMore.set(data.hasMore);this.cursor=data.cursor??'';this.recentRuns.set(data.recentRuns);
    }catch(e:any){if(sequence===this.sequence)this.error.set(e.message==='INTERNAL'?'状況を取得できませんでした。少し待って再読み込みしてください。':e.message??'取得できませんでした');}
    finally{if(sequence===this.sequence)this.loading.set(false);}
  }
  async hold(row:Row){
    const reason=row.held?null:window.prompt('保留理由を入力してください。保留した対象者は計算・公開の対象から外れます。');if(reason!==null&&!reason.trim())return;if(!row.held&&reason===null)return;
    this.running.set(true);this.office.busy.set(true);
    try{await httpsCallable(this.functions,'operationsMonthlyHold')({companyId:this.auth.companyId,officeId:this.office.selected(),yearMonth:this.yearMonth,employeeId:row.employeeId,reason:reason?.trim()??null,expectedVersion:row.holdVersion});
      this.rows.update(rows=>rows.map(r=>r.employeeId===row.employeeId?{...r,held:!!reason,holdReason:reason??'',holdVersion:r.holdVersion+1}:r));this.select(row.employeeId,false);
    }catch(e:any){this.error.set(e.message??'保留を保存できませんでした');}finally{this.running.set(false);this.office.busy.set(false);}
  }
  prepareCollection(){const ids=this.included().filter(r=>r.insuranceConfirmed&&!r.held).slice(0,100).map(r=>r.employeeId);void this.run('createCollection',ids);}
  async run(action:'calculate'|'requestApproval'|'publish'|'createCollection',ids=[...this.selected()]){
    if(this.running()||!ids.length)return;
    if(action==='publish'&&!window.confirm('承認済みの給与・社会保険料の明細を本人に公開しますか？'))return;
    this.running.set(true);this.office.busy.set(true);this.error.set('');this.results.set([]);
    try{const {data}=await httpsCallable<object,{results:{employeeId:string;success:boolean;message:string}[]}>(this.functions,'operationsMonthlyAction',{timeout:300000})({companyId:this.auth.companyId,officeId:this.office.selected(),yearMonth:this.yearMonth,action,employeeIds:ids,requestId:crypto.randomUUID()});this.results.set(data.results);await this.load();}
    catch(e:any){this.error.set(e.message??'処理に失敗しました。状況を更新して確認してください');}
    finally{this.running.set(false);this.office.busy.set(false);}
  }
}
