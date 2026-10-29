import { Component, inject } from '@angular/core';
import { Router, RouterOutlet, RouterLink, RouterLinkActive, ActivatedRoute, NavigationEnd } from '@angular/router';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs/operators';
import { AuthService } from '../../core/services/auth.service';
import { BreadcrumbComponent } from '../breadcrumb/breadcrumb';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [
    RouterOutlet, RouterLink, RouterLinkActive,
    MatSidenavModule, MatToolbarModule, MatListModule,
    MatIconModule, MatButtonModule, MatMenuModule,
    BreadcrumbComponent,
  ],
  templateUrl: './layout.html',
  styleUrl: './layout.scss',
})
export class LayoutComponent {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  auth = inject(AuthService);

  pageTitle = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.getDeepestTitle(this.route)),
    ),
    { initialValue: '' },
  );

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
    { icon: 'trending_up', label: 'シミュレーション', route: '/simulation', roles: ['admin', 'operator', 'viewer'] },
    { icon: 'person', label: 'マイポータル', route: '/portal', roles: ['admin', 'approver', 'operator', 'viewer', 'employee'] },
    { icon: 'settings', label: '設定', route: '/settings', roles: ['admin'] },
  ];

  get visibleNavItems() {
    return this.navItems.filter((item) =>
      this.auth.hasAnyRole(...item.roles as any[]),
    );
  }

  private getDeepestTitle(route: ActivatedRoute): string {
    let title = '';
    let r: ActivatedRoute | null = route;
    while (r) {
      if (r.snapshot.data['title']) {
        title = r.snapshot.data['title'];
      }
      r = r.firstChild;
    }
    return title;
  }

  async logout() {
    await this.auth.logout();
    await this.router.navigate(['/login']);
  }
}
