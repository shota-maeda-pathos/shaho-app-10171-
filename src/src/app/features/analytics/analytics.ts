import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatTabsModule } from '@angular/material/tabs';
import { MatButtonModule } from '@angular/material/button';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../core/services/auth.service';
import { OfficeContextService } from '../../core/services/office-context.service';
import { SimulationComponent } from '../simulation/simulation';
import { CostAnalysisComponent } from './cost-analysis';
interface Analytics {insuranceTrends:{yearMonth:string;totalEmployee:number;totalEmployer:number;healthTotal:number;pensionTotal:number;employeeCount:number}[];filingStats:{draft:number;pending:number;approved:number;submitted:number;accepted:number};forecast:{nextMonth:string;estimatedTotal:number;estimatedEmployee:number;estimatedEmployer:number;basis:string}|null;monthOverMonth:{currentTotal:number;previousTotal:number;changePercent:number|null}|null}
@Component({standalone:true,imports:[CommonModule,FormsModule,MatTabsModule,MatButtonModule,SimulationComponent,CostAnalysisComponent],template:`
  <section class="analytics"><h1>集計・試算</h1><p>{{office.label()}}の確定済み保険料を表示しています。試算結果は実績に登録されません。</p>
    <mat-tab-group [selectedIndex]="tab" (selectedIndexChange)="changeTab($event)">
      <mat-tab label="保険料・届出の集計"><ng-template matTabContent>
        <div class="filter"><label>表示期間 <select [(ngModel)]="months" (change)="load()"><option [ngValue]="6">直近6か月</option><option [ngValue]="12">直近12か月</option></select></label><button mat-stroked-button (click)="load()" [disabled]="loading()">再読み込み</button></div>
        @if(error()) {<p role="alert">{{error()}}</p>}
        @if(loading()) {<p role="status">確定済み実績を集計しています…</p>}
        @if(data();as result) {
          <h2>保険料推移</h2><div class="table-wrap"><table><thead><tr><th>保険料の対象月</th><th>本人負担（円）</th><th>会社負担（円）</th><th>健康保険計（円）</th><th>厚生年金計（円）</th><th>確定済み人数</th></tr></thead><tbody>
            @for(row of result.insuranceTrends;track row.yearMonth) {<tr><td>{{row.yearMonth}}</td><td>{{row.totalEmployee|number}}</td><td>{{row.totalEmployer|number}}</td><td>{{row.healthTotal|number}}</td><td>{{row.pensionTotal|number}}</td><td>{{row.employeeCount}}名</td></tr>}
          </tbody></table></div>
          <p>本人・会社の合計には、計算結果に含まれる介護保険料・支援金・会社負担の拠出金も含みます。</p>
          <h2>届出の状況</h2><div class="totals"><span>下書き {{result.filingStats.draft}}</span><span>承認待ち {{result.filingStats.pending}}</span><span>承認済み {{result.filingStats.approved}}</span><span>提出済み {{result.filingStats.submitted}}</span><span>受理 {{result.filingStats.accepted}}</span></div>
          @if(result.forecast;as forecast) {<section class="forecast"><h2>{{forecast.nextMonth}}の概算</h2><p>本人負担 {{forecast.estimatedEmployee|number}}円 ／ 会社負担 {{forecast.estimatedEmployer|number}}円 ／ 合計 {{forecast.estimatedTotal|number}}円</p><p>直近の確定実績に基づく概算です。今後の異動・報酬変更などをすべて反映した予測ではありません。</p></section>}
        }
      </ng-template></mat-tab>
      <mat-tab label="保険料の分析"><ng-template matTabContent><app-cost-analysis /></ng-template></mat-tab>
      <mat-tab label="保険料の試算"><ng-template matTabContent><app-simulation /></ng-template></mat-tab>
    </mat-tab-group>
  </section>`,styles:[`.analytics{padding:24px}.filter,.totals{display:flex;gap:20px;flex-wrap:wrap;align-items:center;margin:24px 0}.filter select{padding:8px;margin-left:12px}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;min-width:720px}td,th{padding:14px;text-align:right;border-bottom:1px solid #ddd}td:first-child,th:first-child{text-align:left}th{background:#f4f6f8}.forecast{padding:16px 0;border-top:1px solid #ddd}`]})
export class AnalyticsComponent implements OnInit {
  office=inject(OfficeContextService);private auth=inject(AuthService);private functions=inject(Functions);private route=inject(ActivatedRoute);private router=inject(Router);
  months=6;tab=0;data=signal<Analytics|null>(null);loading=signal(false);error=signal('');private sequence=0;
  ngOnInit(){const t=this.route.snapshot.queryParamMap.get('tab');this.tab=t==='simulation'?2:t==='analysis'?1:0;void this.load();}
  changeTab(value:number){this.tab=value;void this.router.navigate([],{queryParams:{tab:['overview','analysis','simulation'][value]},queryParamsHandling:'merge'});}
  async load(){const sequence=++this.sequence;this.loading.set(true);this.data.set(null);this.error.set('');
    try{const {data}=await httpsCallable<object,Analytics>(this.functions,'dashboardAnalytics')({companyId:this.auth.companyId,months:this.months,...this.office.params()});if(sequence===this.sequence)this.data.set(data);}
    catch(e:any){if(sequence===this.sequence)this.error.set(e.message==='INTERNAL'?'集計できませんでした。少し待って再読み込みしてください。':e.message??'集計できませんでした');}finally{if(sequence===this.sequence)this.loading.set(false);}
  }
}
