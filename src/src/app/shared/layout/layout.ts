import { Component, inject } from '@angular/core';
import { Router, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [
    RouterOutlet, RouterLink, RouterLinkActive,
    MatSidenavModule, MatToolbarModule, MatListModule,
    MatIconModule, MatButtonModule, MatMenuModule,
  ],
  templateUrl: './layout.html',
  styleUrl: './layout.scss',
})
export class LayoutComponent {
  private router = inject(Router);
  auth = inject(AuthService);

  navItems = [
    { icon: 'dashboard', label: 'ダッシュボード', route: '/dashboard', roles: ['admin', 'approver', 'operator', 'viewer'] },
    { icon: 'people', label: '従業員', route: '/employees', roles: ['admin', 'operator'] },
    { icon: 'description', label: '届出', route: '/filings', roles: ['admin', 'operator'] },
    { icon: 'check_circle', label: '承認', route: '/approvals', roles: ['admin', 'approver', 'operator'] },
    { icon: 'payments', label: '給与', route: '/salary', roles: ['admin', 'operator'] },
    { icon: 'calculate', label: '保険料', route: '/premium/monthly', roles: ['admin', 'operator'] },
    { icon: 'card_giftcard', label: '賞与保険料', route: '/premium/bonus', roles: ['admin', 'operator'] },
    { icon: 'account_balance', label: '徴収', route: '/premium/collection', roles: ['admin', 'operator'] },
    { icon: 'assessment', label: '算定', route: '/santei', roles: ['admin', 'operator'] },
    { icon: 'person', label: 'マイポータル', route: '/portal', roles: ['admin', 'approver', 'operator', 'viewer', 'employee'] },
    { icon: 'settings', label: '設定', route: '/settings', roles: ['admin'] },
  ];

  get visibleNavItems() {
    return this.navItems.filter((item) =>
      this.auth.hasAnyRole(...item.roles as any[]),
    );
  }

  async logout() {
    await this.auth.logout();
    await this.router.navigate(['/login']);
  }
}
