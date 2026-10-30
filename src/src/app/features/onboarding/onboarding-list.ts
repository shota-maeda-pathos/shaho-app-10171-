import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../core/services/auth.service';
import { OfficeContextService } from '../../core/services/office-context.service';
import { EmptyStateComponent, ErrorStateComponent, LoadingStateComponent, PageHeadComponent } from '../../shared/ui';
import { errorMessage, groupOnboarding, itemTone, OnboardingGroup, OnboardingListItem } from './onboarding.types';

/**
 * 入社のまとめの一覧。入社手続きを事業所×入社日で束ねて出す（データとしては持たない）。
 * まとめを押すと、まとめの画面（賞与と同じ骨組み）に移る。
 */
@Component({
  selector: 'app-onboarding-list',
  standalone: true,
  imports: [DatePipe, FormsModule, RouterLink, MatButtonModule, MatCheckboxModule, MatIconModule, PageHeadComponent, EmptyStateComponent, ErrorStateComponent, LoadingStateComponent],
  template: `
    <div class="app-page">
      <app-page-head heading="入社" kicker="日ごとのまとめ">
        <ng-container meta>
          <span>進行中 <b>{{ activeCount() }}名</b></span>
          <span>あなたの番 <b>{{ yoursCount() }}名</b></span>
        </ng-container>
        <ng-container actions>
          <mat-checkbox [ngModel]="showDone()" (ngModelChange)="showDone.set($event)">完了したまとめも出す</mat-checkbox>
          <a mat-flat-button routerLink="/onboarding/new"><mat-icon>person_add</mat-icon>入社する人を追加</a>
        </ng-container>
      </app-page-head>

      @if (error()) {
        <app-error-state [message]="error()" (retry)="load()" />
      } @else if (loading()) {
        <app-loading-state message="入社手続きを読み込んでいます…" />
      } @else if (!visible().length) {
        <app-empty-state message="進行中の入社手続きはありません" hint="入社する人がいれば「入社する人を追加」から始めます。" icon="badge" />
      } @else {
        <div class="table-wrap">
          <table>
            <thead><tr><th>入社日</th><th>事業所</th><th class="num">人数</th><th>内訳</th><th></th></tr></thead>
            <tbody>
              @for (g of visible(); track g.officeId + g.hireDate) {
                @let c = counts(g);
                <tr (click)="open(g)" tabindex="0" (keydown.enter)="open(g)">
                  <td><b>{{ g.hireDate | date:'yyyy年M月d日' }}</b></td>
                  <td>{{ officeName(g.officeId) }}</td>
                  <td class="num">{{ g.items.length }}名</td>
                  <td><div class="parts">
                    @if (c.attention) { <span class="app-status" data-tone="attention">要確認 {{ c.attention }}名</span> }
                    @if (c.yours) { <span class="app-status" data-tone="yours">あなたの番 {{ c.yours }}名</span> }
                    @if (c.waiting) { <span class="app-status" data-tone="waiting">待ち {{ c.waiting }}名</span> }
                    @if (c.done) { <span class="app-status" data-tone="done">完了 {{ c.done }}名</span> }
                  </div></td>
                  <td class="go"><a mat-button [routerLink]="['/onboarding/group']" [queryParams]="{ officeId: g.officeId, date: g.hireDate }" (click)="$event.stopPropagation()">開く<mat-icon iconPositionEnd>arrow_forward</mat-icon></a></td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <p class="foot">同じ日・同じ事業所に入社する人は、自動で同じまとめに入ります。1人ずつの手続きは、手続き一覧からも開けます。</p>
      }
    </div>
  `,
  styles: [`
    .table-wrap { overflow-x: auto; border: 1px solid var(--app-color-border); border-radius: var(--app-radius); background: var(--app-color-surface); }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: var(--app-font-xs); font-weight: 600; color: var(--app-color-text-sub); background: var(--app-color-surface-sub); white-space: nowrap; }
    th, td { padding: var(--app-space-2) var(--app-space-3); border-bottom: 1px solid var(--app-color-border); }
    tbody tr { cursor: pointer; }
    tbody tr:hover td { background: #fafbfd; }
    tbody tr:last-child td { border-bottom: 0; }
    tbody tr:focus-visible { outline: 2px solid var(--app-color-link); outline-offset: -2px; }
    .num { text-align: right; white-space: nowrap; }
    .parts { display: flex; gap: var(--app-space-1); flex-wrap: wrap; }
    .go { text-align: right; }
    .foot { margin: var(--app-space-2) 0 0; font-size: var(--app-font-xs); color: var(--app-color-text-sub); }
  `],
})
export class OnboardingListComponent implements OnInit {
  private functions = inject(Functions);
  private auth = inject(AuthService);
  private office = inject(OfficeContextService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  items = signal<OnboardingListItem[]>([]);
  loading = signal(true);
  error = signal('');
  showDone = signal(false);

  groups = computed(() => groupOnboarding(this.items()));
  /** 既定では、終わっていない人がいるまとめだけを出す */
  visible = computed(() => this.showDone() ? this.groups() : this.groups().filter(g => g.items.some(i => i.current !== 'done')));
  activeCount = computed(() => this.items().filter(i => i.current !== 'done').length);
  yoursCount = computed(() => this.items().filter(i => itemTone(i) === 'yours' || itemTone(i) === 'attention').length);

  async ngOnInit() {
    await this.load();
    // 以前の「まとめて始めた入社」へのリンク（?batchId=）は、その人たちのまとめの画面へ移す
    const batchId = this.route.snapshot.queryParamMap.get('batchId');
    const first = batchId ? this.items().find(i => i.batchId === batchId) : null;
    if (first) await this.router.navigate(['/onboarding/group'], { queryParams: { officeId: first.officeId, date: first.hireDate }, replaceUrl: true });
  }

  counts(g: OnboardingGroup) {
    const tones = g.items.map(itemTone);
    return {
      attention: tones.filter(t => t === 'attention').length,
      yours: tones.filter(t => t === 'yours').length,
      waiting: tones.filter(t => t === 'waiting').length,
      done: tones.filter(t => t === 'done').length,
    };
  }

  officeName(id: string) {
    return this.office.offices().find(o => o.id === id)?.name ?? '';
  }

  open(g: OnboardingGroup) {
    void this.router.navigate(['/onboarding/group'], { queryParams: { officeId: g.officeId, date: g.hireDate } });
  }

  async load() {
    this.loading.set(true);
    this.error.set('');
    try {
      const { data } = await httpsCallable<object, { items: OnboardingListItem[] }>(this.functions, 'onboardingList')({
        companyId: this.auth.companyId, ...this.office.params(), includeCompleted: true,
      });
      this.items.set(data.items.filter(i => i.status !== 'cancelled'));
    } catch (e) {
      this.error.set(errorMessage(e, '入社手続きを読み込めませんでした'));
    } finally {
      this.loading.set(false);
    }
  }
}
