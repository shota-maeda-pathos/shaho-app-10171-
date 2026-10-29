import { PortalPayslip } from './portal.types';
import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-portal-detail',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule, MatIconModule, MatCardModule,
    MatDividerModule, MatProgressSpinnerModule,
  ],
  template: `
    <div class="page-container">
      <div class="page-header"><button mat-icon-button (click)="goBack()"><mat-icon>arrow_back</mat-icon></button><h1>給与・社会保険料 — {{ yearMonth() }}</h1></div>
      @if (loading()) {
        <div class="loading-container"><mat-spinner diameter="40" /></div>
      } @else if (error()) {
        <p role="alert">{{ error() }}</p><button mat-stroked-button (click)="loadPayslip()">再読み込み</button>
      } @else if (payslip(); as slip) {
        <mat-card class="payslip-card">
          <h2>{{ slip.employeeName }}</h2>
          <div class="section"><h3>承認済み給与</h3>
            <div class="line-item"><span>基本給</span><span>{{ slip.baseSalary === null ? '未登録' : (slip.baseSalary | number) + ' 円' }}</span></div>
            @for (key of objectKeys(slip.fixedAllowances); track key) {
              <div class="line-item"><span>{{ key }}</span><span>{{ slip.fixedAllowances[key] | number }} 円</span></div>
            }
            @for (key of objectKeys(slip.variableAllowances); track key) {
              <div class="line-item"><span>{{ key }}</span><span>{{ slip.variableAllowances[key] | number }} 円</span></div>
            }
            <div class="line-item total"><span>支給合計</span><span>{{ slip.totalSalary === null ? '未登録' : (slip.totalSalary | number) + ' 円' }}</span></div>
          </div>
          <mat-divider />
          <div class="section"><h3>同月分の社会保険料（本人負担・承認済み計算額）</h3>
            @if (slip.insurance; as premium) {
              <div class="line-item"><span>健康保険料</span><span>{{ premium.health === null ? '未登録' : (premium.health | number) + ' 円' }}</span></div>
              <div class="line-item"><span>厚生年金保険料</span><span>{{ premium.pension === null ? '未登録' : (premium.pension | number) + ' 円' }}</span></div>
              <div class="line-item"><span>介護保険料</span><span>{{ premium.longTermCare === null ? '未登録' : (premium.longTermCare | number) + ' 円' }}</span></div>
              <div class="line-item"><span>子ども・子育て関連拠出</span><span>{{ premium.childSupport === null ? '未登録' : (premium.childSupport | number) + ' 円' }}</span></div>
              <div class="line-item total"><span>本人負担合計</span><span>{{ premium.totalEmployee === null ? '未登録' : (premium.totalEmployee | number) + ' 円' }}</span></div>
              @if (premium.isExempted) { <p>この発生月には免除が適用されています。</p> }
            } @else { <p>同月分の社会保険料は未計算または未承認です。</p> }
            <p>表示額は保険料の発生月の計算結果です。給与からの実際の控除額・差引支給額を示すものではありません。</p>
          </div>
        </mat-card>
      }
    </div>
  `,
  styles: [`
    .page-container { padding: 24px; max-width: 640px; margin: 0 auto; }
    .page-header { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
    .page-header h1 { margin: 0; font-size: 24px; font-weight: 500; }
    .loading-container { display: flex; justify-content: center; padding: 48px; }
    .payslip-card { padding: 32px; }
    .payslip-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .payslip-header h2 { margin: 0; font-size: 20px; }
    .period { font-size: 16px; color: #666; }
    .section { padding: 16px 0; }
    .section h3 { margin: 0 0 12px; font-size: 14px; font-weight: 500; color: #666; text-transform: uppercase; letter-spacing: 1px; }
    .line-item { display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px; }
    .line-item.total { border-top: 1px solid #e0e0e0; padding-top: 12px; margin-top: 8px; font-weight: 600; }
    .line-item.grand-total { font-size: 20px; font-weight: 700; color: #1976d2; }
    .amount { font-family: 'Roboto Mono', monospace; }
    .empty-card { padding: 32px; }
    .empty-state { text-align: center; padding: 32px; color: #666; }
    .empty-state mat-icon { font-size: 48px; width: 48px; height: 48px; color: #ccc; }
    mat-divider { margin: 0 -32px; }
    .net { padding-top: 24px; }
  `],
})
export class PortalDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private functions = inject(Functions);
  private auth = inject(AuthService);

  yearMonth = signal('');
  payslip = signal<PortalPayslip | null>(null);
  loading = signal(false);
  error = signal('');
  objectKeys = Object.keys;
  ngOnInit() {
    this.yearMonth.set(this.route.snapshot.paramMap.get('id') ?? '');
    void this.loadPayslip();
  }
  goBack() { this.router.navigate(['/portal']); }
  async loadPayslip() {
    if (this.loading()) return;
    this.loading.set(true); this.error.set(''); this.payslip.set(null);
    try {
      const fn = httpsCallable<object, PortalPayslip>(this.functions, 'portalPayslipGet');
      const { data } = await fn({ companyId: this.auth.companyId, yearMonth: this.yearMonth() });
      this.payslip.set(data);
    } catch (e: any) { this.error.set(`給与情報を取得できませんでした：${e.message ?? '再読み込みしてください'}`); }
    finally { this.loading.set(false); }
  }
}
