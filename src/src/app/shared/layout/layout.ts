import { Component, HostListener, computed, inject } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Router, RouterOutlet, RouterLink, NavigationEnd } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs/operators';
import { BreadcrumbComponent } from '../breadcrumb/breadcrumb';
import { LogoComponent } from '../ui/logo';
import { OfficeContextService } from '../../core/services/office-context.service';
import { AuthService, Role } from '../../core/services/auth.service';
import { ApprovalBadgeService } from '../../core/services/approval-badge.service';

interface NavItem { icon: string; label: string; route: string; roles: Role[]; match: string[] }

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [
    RouterOutlet, RouterLink, NgTemplateOutlet,
    MatIconModule, MatButtonModule, MatMenuModule,
    BreadcrumbComponent, LogoComponent,
  ],
  templateUrl: './layout.html',
  styleUrl: './layout.scss',
})
export class LayoutComponent {
  private router = inject(Router);
  auth = inject(AuthService);
  office=inject(OfficeContextService);
  approvalBadge = inject(ApprovalBadgeService);

  constructor() {
    this.approvalBadge.start();
    // 画面を移ったら件数を読み直す（承認したあとに古い件数が残らないように）。続けて移るときは15秒に1回まで
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => this.approvalBadge.refreshOnNavigation());
  }

  /** 今のURL（パスだけ）。画面を移動するたびに選択表示を描き直す */
  url = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.router.url.split(/[?#]/)[0]),
    ),
    { initialValue: this.router.url.split(/[?#]/)[0] },
  );

  /**
   * サイドバーは5項目（ui-proposals の案どおり）。集計・設定は「管理」の下に置く（用語の説明は各画面の「?」で読む）。
   * 手続きを始める・毎月の処理・賞与・算定・各手続きの画面は「手続き」の中として扱う。
   * match は、その項目を選択中として表示するURLの先頭（業務の途中の画面も含める）
   */
  navItems: NavItem[] = [
    { icon: 'home', label: 'ホーム', route: '/home', roles: ['admin', 'approver', 'operator', 'viewer'], match: ['/home'] },
    {
      icon: 'assignment', label: '手続き', route: '/procedures', roles: ['admin', 'operator', 'approver'],
      match: ['/procedures', '/onboarding', '/monthly', '/salary', '/premium', '/santei', '/bonus', '/resignation', '/dependents', '/leaves', '/transfers', '/employment-changes', '/age-events', '/revisions'],
    },
    { icon: 'check_circle', label: '承認', route: '/approvals', roles: ['admin', 'approver', 'operator'], match: ['/approvals'] },
    { icon: 'description', label: '届出', route: '/filings', roles: ['admin', 'operator'], match: ['/filings'] },
    { icon: 'people', label: '従業員', route: '/employees', roles: ['admin', 'operator'], match: ['/employees'] },
  ];
  moreItems: NavItem[] = [
    { icon: 'trending_up', label: '集計・試算', route: '/analytics', roles: ['admin', 'operator', 'viewer'], match: ['/analytics', '/simulation'] },
    { icon: 'settings', label: '事業所・設定', route: '/settings', roles: ['admin'], match: ['/settings'] },
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

  /** サイドバーの下の利用者欄 */
  initial = computed(() => (this.auth.profile()?.displayName ?? '').trim().charAt(0) || '?');
  roleLabel = computed(() => {
    const labels: Record<Role, string> = { admin: '管理者', approver: '承認者', operator: '担当者', viewer: '閲覧者', employee: '従業員' };
    return (this.auth.profile()?.roles ?? []).filter(r => r !== 'employee').map(r => labels[r]).join('・') || labels.employee;
  });

  /** 上の検索は手続き一覧の検索に渡す */
  canSearch = computed(() => { this.auth.profile(); return this.auth.hasAnyRole('admin', 'operator', 'approver'); });
  search(event: Event, input: HTMLInputElement) {
    event.preventDefault();
    const q = input.value.trim();
    void this.router.navigate(['/procedures'], { queryParams: { ...this.office.queryParams(), ...(q ? { q } : {}) } });
    input.blur();
  }
  /** Ctrl+K（Mac は ⌘K）で検索欄へ */
  @HostListener('document:keydown', ['$event'])
  focusSearch(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      const input = document.querySelector<HTMLInputElement>('.topbar .search input');
      if (input) { event.preventDefault(); input.focus(); input.select(); }
    }
  }

  private visible(items: NavItem[]) {
    this.auth.profile();
    return items.filter((item) => this.auth.hasAnyRole(...item.roles));
  }
  async changeOffice(event:Event){const select=event.target as HTMLSelectElement;await this.office.change(select.value);select.value=this.office.selected();}

  async logout() {
    await this.auth.logout();
    await this.router.navigate(['/login']);
  }
}
