import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterOutlet, RouterLink, ActivatedRoute, NavigationEnd } from '@angular/router';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs/operators';
import { BreadcrumbComponent } from '../breadcrumb/breadcrumb';
import { OfficeContextService } from '../../core/services/office-context.service';
import { AuthService, Role } from '../../core/services/auth.service';
import { ApprovalBadgeService } from '../../core/services/approval-badge.service';

interface NavItem { icon: string; label: string; route: string; roles: Role[]; match: string[] }

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [
    RouterOutlet, RouterLink,
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
  approvalBadge = inject(ApprovalBadgeService);

  constructor() {
    this.approvalBadge.start();
    // 画面を移るたびに件数を読み直す（承認したあとに古い件数が残らないように）
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => void this.approvalBadge.refresh());
  }

  pageTitle = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.getDeepestTitle(this.route)),
    ),
    { initialValue: '' },
  );

  /** 今のURL（パスだけ）。画面を移動するたびに選択表示を描き直す */
  url = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.router.url.split(/[?#]/)[0]),
    ),
    { initialValue: this.router.url.split(/[?#]/)[0] },
  );

  /**
   * サイドバーは5項目。届出・集計・設定などは「その他」にまとめる。
   * match は、その項目を選択中として表示するURLの先頭（業務の途中の画面も含める）
   */
  navItems: NavItem[] = [
    { icon: 'home', label: 'ホーム', route: '/home', roles: ['admin', 'approver', 'operator', 'viewer'], match: ['/home'] },
    { icon: 'add_circle', label: '手続きを始める', route: '/procedures/new', roles: ['admin', 'operator'], match: ['/procedures/new', '/onboarding/new', '/premium', '/santei'] },
    { icon: 'event_repeat', label: '毎月の処理', route: '/monthly', roles: ['admin', 'operator', 'approver'], match: ['/monthly', '/salary'] },
    { icon: 'people', label: '従業員', route: '/employees', roles: ['admin', 'operator'], match: ['/employees'] },
    { icon: 'check_circle', label: '承認', route: '/approvals', roles: ['admin', 'approver', 'operator'], match: ['/approvals'] },
  ];
  moreItems: NavItem[] = [
    { icon: 'assignment', label: '進行中の手続き', route: '/procedures', roles: ['admin', 'operator', 'approver'], match: ['/procedures', '/onboarding'] },
    { icon: 'description', label: '届出・帳票', route: '/filings', roles: ['admin', 'operator'], match: ['/filings'] },
    { icon: 'trending_up', label: '集計・試算', route: '/analytics', roles: ['admin', 'operator', 'viewer'], match: ['/analytics', '/simulation'] },
    { icon: 'menu_book', label: '用語集', route: '/glossary', roles: ['admin', 'approver', 'operator', 'viewer'], match: ['/glossary'] },
    { icon: 'settings', label: '設定', route: '/settings', roles: ['admin'], match: ['/settings'] },
  ];

  visibleNavItems = computed(() => this.visible(this.navItems));
  visibleMoreItems = computed(() => this.visible(this.moreItems));

  /** 選択中の項目。いちばん長く一致したURLの項目を1つだけ選ぶ（/procedures/new と /procedures を区別する） */
  activeRoute = computed(() => {
    const url = this.url();
    let best: { route: string; length: number } | null = null;
    for (const item of [...this.navItems, ...this.moreItems]) {
      for (const prefix of item.match) {
        const hit = url === prefix || url.startsWith(prefix + '/');
        if (hit && (!best || prefix.length > best.length)) best = { route: item.route, length: prefix.length };
      }
    }
    return best?.route ?? null;
  });

  /** 「その他」を開いているか。選択中の項目が中にあれば開く */
  moreOpen = signal(false);
  moreShown = computed(() => this.moreOpen() || this.visibleMoreItems().some(i => i.route === this.activeRoute()));

  private visible(items: NavItem[]) {
    this.auth.profile();
    return items.filter((item) => this.auth.hasAnyRole(...item.roles));
  }
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
