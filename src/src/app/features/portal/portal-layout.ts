import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { AuthService } from '../../core/services/auth.service';
import { LogoComponent } from '../../shared/ui';
@Component({standalone:true,imports:[RouterLink,RouterOutlet,MatButtonModule,LogoComponent],template:`
  <header><a routerLink="/portal" class="brand"><app-logo [size]="24" /><span>マイポータル</span></a><span>{{auth.profile()?.displayName}}</span>
    @if(auth.hasAnyRole('admin','operator','approver','viewer')&&!auth.profile()?.isSuspended) {<a mat-stroked-button routerLink="/home">管理画面へ</a>}
    <button mat-button (click)="logout()">ログアウト</button></header><main><router-outlet /></main>`,
  styles:[`header{display:flex;gap:20px;align-items:center;padding:16px 24px;border-bottom:1px solid #ddd;flex-wrap:wrap}header{background:var(--app-color-surface);border-bottom-color:var(--app-color-border)}.brand{display:inline-flex;align-items:center;gap:12px;margin-right:auto;color:var(--app-color-text-sub);font-weight:600;text-decoration:none}main{max-width:1100px;margin:auto}`]})
export class PortalLayoutComponent {auth=inject(AuthService);private router=inject(Router);async logout(){await this.auth.logout();await this.router.navigate(['/login']);}}
