import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'app-onboard-complete',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatCardModule, MatButtonModule],
  template: `
    <div class="complete-container">
      <mat-card class="complete-card">
        <div class="icon-wrapper">
          <mat-icon>check_circle</mat-icon>
        </div>
        <h1>送信完了</h1>
        <p class="message">入社手続きの入力が完了しました。</p>
        <p class="sub-message">担当者が内容を確認し、承認後にアカウントが有効になります。<br>確認完了までしばらくお待ちください。</p>

        <div class="info-box">
          <mat-icon>info</mat-icon>
          <div>
            <p><strong>次のステップ</strong></p>
            <ul>
              <li>担当者が入力内容を確認します</li>
              <li>承認後、ログイン情報がメールで届きます</li>
              <li>届いたらポータルにログインできます</li>
            </ul>
          </div>
        </div>
      </mat-card>
    </div>
  `,
  styles: [`
    .complete-container { max-width: 560px; margin: 0 auto; padding: 80px 24px; }
    .complete-card { padding: 48px; text-align: center; }
    .icon-wrapper { margin-bottom: 24px; }
    .icon-wrapper mat-icon { font-size: 72px; width: 72px; height: 72px; color: #4caf50; }
    h1 { font-size: 28px; font-weight: 500; margin: 0 0 8px; }
    .message { font-size: 16px; color: #333; margin: 0 0 8px; }
    .sub-message { font-size: 14px; color: #666; line-height: 1.8; margin: 0 0 32px; }
    .info-box { display: flex; gap: 12px; text-align: left; padding: 16px; background: #e3f2fd; border-radius: 8px; }
    .info-box mat-icon { color: #1976d2; margin-top: 2px; }
    .info-box p { margin: 0 0 8px; font-size: 14px; }
    .info-box ul { margin: 0; padding-left: 20px; font-size: 13px; color: #555; }
    .info-box li { margin-bottom: 4px; }
  `],
})
export class OnboardCompleteComponent implements OnInit {
  private route = inject(ActivatedRoute);
  token = '';

  ngOnInit() {
    this.token = this.route.snapshot.paramMap.get('token') ?? '';
  }
}
