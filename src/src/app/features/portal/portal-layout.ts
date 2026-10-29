import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { AuthService } from '../../core/services/auth.service';
@Component({standalone:true,imports:[RouterLink,RouterOutlet,MatButtonModule],template:`
  <header><a routerLink="/portal">社保管理 — マイポータル</a><span>{{auth.profile()?.displayName}}</span>
    @if(auth.hasAnyRole('admin','operator','approver','viewer')&&!auth.profile()?.isSuspended) {<a mat-stroked-button routerLink="/home">管理画面へ</a>}
    <button mat-button (click)="logout()">ログアウト</button></header><main><router-outlet /></main>`,
  styles:[`header{display:flex;gap:20px;align-items:center;padding:16px 24px;border-bottom:1px solid #ddd;flex-wrap:wrap}header>a:first-child{margin-right:auto;color:#172a3b;font-weight:600;text-decoration:none}main{max-width:1100px;margin:auto}`]})
export class PortalLayoutComponent {auth=inject(AuthService);private router=inject(Router);async logout(){await this.auth.logout();await this.router.navigate(['/login']);}}
