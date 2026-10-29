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
import { OfficeContextService } from '../../core/services/office-context.service';

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
  office=inject(OfficeContextService);

  pageTitle = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.getDeepestTitle(this.route)),
    ),
    { initialValue: '' },
  );

  navItems = [
    { icon: 'dashboard', label: 'ホーム', route: '/home', roles: ['admin', 'approver', 'operator', 'viewer'] },
    { icon: 'assignment', label: '手続き', route: '/procedures', roles: ['admin', 'operator', 'approver'] },
    { icon: 'event_repeat', label: '定例業務', route: '/operations', roles: ['admin', 'operator'] },
    { icon: 'people', label: '従業員台帳', route: '/employees', roles: ['admin', 'operator'] },
    { icon: 'check_circle', label: '承認', route: '/approvals', roles: ['admin', 'approver', 'operator'] },
    { icon: 'description', label: '届出・帳票', route: '/filings', roles: ['admin', 'operator'] },
    { icon: 'trending_up', label: '集計・試算', route: '/analytics', roles: ['admin', 'operator', 'viewer'] },
    { icon: 'menu_book', label: '用語集', route: '/glossary', roles: ['admin', 'approver', 'operator', 'viewer'] },
    { icon: 'settings', label: '設定', route: '/settings', roles: ['admin'] },
  ];

  get visibleNavItems() {
    return this.navItems.filter((item) =>
      this.auth.hasAnyRole(...item.roles as any[]),
    );
  }
  active(route:string) {return route==='/operations'&&['/salary','/premium','/santei'].some(prefix=>this.router.url.startsWith(prefix))||route==='/analytics'&&this.router.url.startsWith('/simulation');}
  async changeOffice(event:Event){const select=event.target as HTMLSelectElement;await this.office.change(select.value);select.value=this.office.selected();}

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
