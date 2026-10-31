import { Component, inject } from '@angular/core';
import { Router, ActivatedRoute, NavigationEnd, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { filter, map } from 'rxjs/operators';
import { toSignal } from '@angular/core/rxjs-interop';

export interface Breadcrumb {
  label: string;
  url: string;
}

@Component({
  selector: 'app-breadcrumb',
  standalone: true,
  imports: [RouterLink, MatIconModule],
  template: `
    <nav class="breadcrumb" aria-label="パンくずリスト">
      @for (crumb of breadcrumbs(); track crumb.url; let last = $last) {
        @if (!last) {
          <a [routerLink]="crumb.url" class="crumb-link">{{ crumb.label }}</a>
          <mat-icon class="separator">chevron_right</mat-icon>
        } @else {
          <span class="crumb-current">{{ crumb.label }}</span>
        }
      }
    </nav>
  `,
  styles: `
    :host { min-width: 0; }
    .breadcrumb { display: flex; align-items: center; gap: 2px; font-size: 13px; color: var(--app-color-muted); white-space: nowrap; overflow: hidden; }
    .crumb-link { color: var(--app-color-muted); text-decoration: none; &:hover { color: var(--app-color-link); text-decoration: underline; } }
    .crumb-current { color: var(--app-color-text); font-weight: 600; overflow: hidden; text-overflow: ellipsis; }
    .separator { font-size: 16px; width: 16px; height: 16px; color: var(--app-color-muted); flex: none; }
  `,
})
export class BreadcrumbComponent {
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  breadcrumbs = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.buildBreadcrumbs(this.route.root)),
    ),
    { initialValue: [] as Breadcrumb[] },
  );

  private buildBreadcrumbs(route: ActivatedRoute, url = '', crumbs: Breadcrumb[] = []): Breadcrumb[] {
    const children = route.children;
    for (const child of children) {
      const segments = child.snapshot.url.map((s) => s.path);
      if (segments.length) {
        url += '/' + segments.join('/');
      }
      const title = child.snapshot.data['title'];
      // 空のパスの子は親の title を受け継ぐので、同じ場所を2回並べない
      if (title && crumbs.at(-1)?.url !== url) {
        crumbs.push({ label: title, url });
      }
      return this.buildBreadcrumbs(child, url, crumbs);
    }
    return crumbs;
  }
}
