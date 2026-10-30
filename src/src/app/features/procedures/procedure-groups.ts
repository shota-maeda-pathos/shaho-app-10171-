import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../core/services/auth.service';
import { OfficeContextService } from '../../core/services/office-context.service';
import {
  EmptyStateComponent, ErrorStateComponent, LoadingStateComponent, PageHeadComponent, StatusTone, StepLeadComponent, StepperComponent,
  StepperItem, TargetCellDirective, TargetListComponent, TargetRow,
} from '../../shared/ui';
import { errorMessage } from '../onboarding/onboarding.types';

/** functions/src/procedures/group-list.ts の GroupListItem と同じ形 */
export interface GroupItem {
  id: string; version: number; status: string; name: string; employeeId: string | null; officeId: string;
  date: string | null; kind: string | null; current: string; currentDetail: string | null; returned: boolean; waitingApproval: boolean;
}

export type GroupType = 'loss' | 'age_event';

/**
 * 退職・年齢到達の「まとめ」（docs/ui-unification-design.md の3章）。データでは持たず、事業所×日で表示するときに束ねる。
 * 退職＝退職日ごと（未入力の人は「退職日 未入力」）、年齢到達＝到達月ごと。入社は features/onboarding が同じ形で持つ。
 */
interface GroupConfig {
  title: string;
  kicker: string;
  route: string;
  steps: { key: string; label: string }[];
  /** まとめの鍵（退職日・到達月。未入力は none） */
  keyOf: (i: GroupItem) => string;
  groupLabel: (key: string) => string;
  sub: (i: GroupItem) => string | undefined;
  emptyHint: string;
}

const ymd = (date: string) => { const [y, m, d] = date.split('-').map(Number); return `${y}年${m}月${d}日`; };

export const GROUP_CONFIGS: Record<GroupType, GroupConfig> = {
  loss: {
    title: '退職',
    kicker: '日ごとのまとめ',
    route: '/resignation',
    steps: [
      { key: 'entry', label: '退職日と理由' }, { key: 'settlement', label: '最後の保険料' }, { key: 'account', label: '退職後のアカウント' },
      { key: 'filing', label: '届出の作成' }, { key: 'approval', label: '承認' }, { key: 'submit', label: '提出' }, { key: 'confirm', label: '完了の確認' },
    ],
    keyOf: i => i.date ?? 'none',
    groupLabel: key => key === 'none' ? '退職日 未入力' : `${ymd(key)} 退職`,
    sub: () => undefined,
    emptyHint: '退職する人がいれば「手続きを始める」の「人が退職する」から始めます。',
  },
  age_event: {
    title: '年齢到達',
    kicker: '月ごとのまとめ',
    route: '/age-events',
    steps: [
      { key: 'check', label: '到達日と届出の要否' }, { key: 'filing', label: '届出の作成' }, { key: 'approval', label: '承認' },
      { key: 'submit', label: '提出' }, { key: 'confirm', label: '完了の確認' },
    ],
    keyOf: i => i.date?.slice(0, 7) ?? 'none',
    groupLabel: key => { const [y, m] = key.split('-').map(Number); return key === 'none' ? '到達日 不明' : `${y}年${m}月 到達`; },
    sub: i => `${i.kind === 'health75' ? '75歳' : '70歳'}・到達日 ${i.date ? ymd(i.date) : '—'}`,
    emptyHint: '70歳・75歳になる人は、ホームのやることや「手続きを始める」から始めます。',
  },
};

export function itemTone(i: GroupItem): 'yours' | 'attention' | 'waiting' | 'done' {
  if (i.current === 'done') return 'done';
  if (i.returned) return 'attention';
  if (i.waitingApproval) return 'waiting';
  return 'yours';
}

async function loadGroupItems(functions: Functions, companyId: string, type: GroupType, officeId?: string) {
  const { data } = await httpsCallable<object, { items: GroupItem[] }>(functions, 'procedureGroupList')({
    companyId, procedureType: type, includeCompleted: true, ...(officeId ? { officeId } : {}),
  });
  return data.items;
}

/**
 * まとめの一覧（?key がないとき）とまとめの画面（?officeId=&key= のとき）。ルートの data.groupType で退職・年齢到達を選ぶ。
 * まとめの画面は賞与・入社と同じ骨組みで、ステップの数字は人数の内訳、押すと絞り込み、行にミニステップ、名前で1人の画面へ。
 */
@Component({
  selector: 'app-procedure-groups',
  standalone: true,
  imports: [
    DatePipe, FormsModule, RouterLink, MatButtonModule, MatCheckboxModule, MatIconModule, PageHeadComponent, StepperComponent, StepLeadComponent,
    TargetListComponent, TargetCellDirective, EmptyStateComponent, ErrorStateComponent, LoadingStateComponent,
  ],
  template: `
    <div class="app-page">
      @if (!groupKey()) {
        <!-- まとめの一覧 -->
        <app-page-head [heading]="config.title" [kicker]="config.kicker">
          <ng-container meta>
            <span>進行中 <b>{{ activeCount() }}名</b></span>
          </ng-container>
          <ng-container actions>
            <mat-checkbox [ngModel]="showDone()" (ngModelChange)="showDone.set($event)">完了したまとめも出す</mat-checkbox>
            <a mat-stroked-button routerLink="/procedures/new">手続きを始める</a>
          </ng-container>
        </app-page-head>
        @if (error()) {
          <app-error-state [message]="error()" (retry)="load()" />
        } @else if (loading()) {
          <app-loading-state />
        } @else if (!visibleGroups().length) {
          <app-empty-state [message]="'進行中の' + config.title + 'の手続きはありません'" [hint]="config.emptyHint" icon="event" />
        } @else {
          <div class="table-wrap">
            <table class="groups">
              <thead><tr><th>まとめ</th><th>事業所</th><th class="num">人数</th><th>内訳</th><th></th></tr></thead>
              <tbody>
                @for (g of visibleGroups(); track g.officeId + g.key) {
                  <tr (click)="openGroup(g.officeId, g.key)" tabindex="0" (keydown.enter)="openGroup(g.officeId, g.key)">
                    <td><b>{{ config.groupLabel(g.key) }}</b></td>
                    <td>{{ officeName(g.officeId) }}</td>
                    <td class="num">{{ g.items.length }}名</td>
                    <td><div class="parts">
                      @for (t of toneCounts(g.items); track t.tone) { <span class="app-status" [attr.data-tone]="t.tone">{{ t.label }} {{ t.count }}名</span> }
                    </div></td>
                    <td class="go"><button mat-button type="button">開く<mat-icon iconPositionEnd>arrow_forward</mat-icon></button></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <p class="foot">同じ日（年齢到達は同じ月）・同じ事業所の人は、自動で同じまとめに入ります。1人ずつの手続きは、手続き一覧からも開けます。</p>
        }
      } @else {
        <!-- まとめの画面 -->
        <app-page-head [heading]="config.groupLabel(groupKey())" [kicker]="config.title" [backLink]="config.route" [backLabel]="config.title + 'のまとめの一覧'">
          <ng-container meta>
            <span>{{ officeName(officeId()) }}</span>
            <span>対象 <b>{{ members().length }}名</b></span>
            @if (doneCount()) { <span>完了 {{ doneCount() }}名</span> }
          </ng-container>
          <ng-container actions>
            <button mat-button type="button" (click)="load()" [disabled]="loading()"><mat-icon>refresh</mat-icon>読み込み直す</button>
          </ng-container>
        </app-page-head>
        @if (error()) {
          <app-error-state [message]="error()" (retry)="load()" />
        } @else if (loading() && !members().length) {
          <app-loading-state />
        } @else if (!members().length) {
          <app-empty-state message="このまとめの手続きはありません" [hint]="config.emptyHint" icon="event" />
        } @else {
          <app-stepper [steps]="stepItems()" [current]="stepFilter() ?? ''" [label]="config.title + 'のステップ'" (select)="stepFilter.set($event)" />
          <section class="panel" aria-labelledby="group-lead">
            <app-step-lead [heading]="stepFilter() ? stepLabel(stepFilter()!) : '全員の進み具合'" headingId="group-lead"
                           [text]="stepFilter() ? 'このステップにいる人です。名前を押すと1人の画面で続きを進めます。' : '名前を押すと1人の画面に移ります。'">
              @if (stepFilter()) { <button right mat-button type="button" (click)="stepFilter.set(null)">全員を表示</button> }
            </app-step-lead>
            <app-target-list [rows]="rows()" [loading]="loading()" cellHeader="進み具合" defaultFilter="all"
                             emptyInfo="1人ずつの画面で進めます。名前を押してください。" (open)="openPerson($event.id)">
              <ng-template appTargetCell let-row>
                @if (itemOf(row.id); as i) {
                  <span class="mini" aria-hidden="true">
                    @for (s of config.steps; track s.key; let n = $index) {
                      <i [class.d]="n < stepIndex(i)" [class.c]="n === stepIndex(i)" [class.w]="n === stepIndex(i) && tone(i) === 'waiting'"></i>
                    }
                  </span>
                  <div class="sub">{{ i.current === 'done' ? '完了' : stepLabel(i.current) }}</div>
                }
              </ng-template>
            </app-target-list>
          </section>
        }
      }
    </div>
  `,
  styles: [`
    .table-wrap { overflow-x: auto; border: 1px solid var(--app-color-border); border-radius: var(--app-radius); background: var(--app-color-surface); }
    table.groups { width: 100%; border-collapse: collapse; }
    .groups th { text-align: left; font-size: var(--app-font-xs); font-weight: 600; color: var(--app-color-text-sub); background: var(--app-color-surface-sub); white-space: nowrap; }
    .groups th, .groups td { padding: var(--app-space-2) var(--app-space-3); border-bottom: 1px solid var(--app-color-border); }
    .groups tbody tr { cursor: pointer; }
    .groups tbody tr:hover td { background: #fafbfd; }
    .groups tbody tr:last-child td { border-bottom: 0; }
    .num { text-align: right; white-space: nowrap; }
    .parts { display: flex; gap: var(--app-space-1); flex-wrap: wrap; }
    .go { text-align: right; }
    .foot { margin: var(--app-space-2) 0 0; font-size: var(--app-font-xs); color: var(--app-color-text-sub); }
    .panel { padding: var(--app-space-4) var(--app-space-5) var(--app-space-5); border: 1px solid var(--app-color-border); border-radius: var(--app-radius); background: var(--app-color-surface); }
    .mini { display: inline-flex; gap: 3px; align-items: center; }
    .mini i { width: 14px; height: 4px; border-radius: 2px; background: var(--app-color-border); }
    .mini i.d { background: var(--app-status-done-fg); }
    .mini i.c { background: var(--app-status-yours-fg); }
    .mini i.w { background: var(--app-status-waiting-fg); }
    .sub { margin-top: 3px; font-size: var(--app-font-xs); color: var(--app-color-text-sub); }
  `],
})
export class ProcedureGroupsComponent {
  private functions = inject(Functions);
  private auth = inject(AuthService);
  private office = inject(OfficeContextService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  readonly type = this.route.snapshot.data['groupType'] as GroupType;
  readonly config = GROUP_CONFIGS[this.type];
  private query = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  groupKey = computed(() => this.query().get('key') ?? '');
  officeId = computed(() => this.query().get('officeId') ?? '');

  items = signal<GroupItem[]>([]);
  loading = signal(true);
  error = signal('');
  showDone = signal(false);
  stepFilter = signal<string | null>(null);

  groups = computed(() => {
    const map = new Map<string, { officeId: string; key: string; items: GroupItem[] }>();
    for (const i of this.items()) {
      const key = `${i.officeId}|${this.config.keyOf(i)}`;
      if (!map.has(key)) map.set(key, { officeId: i.officeId, key: this.config.keyOf(i), items: [] });
      map.get(key)!.items.push(i);
    }
    // 未入力のまとめは先頭（日付を入れるのが最初のやること）
    return [...map.values()].sort((a, b) => (a.key === 'none' ? '' : a.key).localeCompare(b.key === 'none' ? '' : b.key) || a.officeId.localeCompare(b.officeId));
  });
  visibleGroups = computed(() => this.showDone() ? this.groups() : this.groups().filter(g => g.items.some(i => i.current !== 'done')));
  activeCount = computed(() => this.items().filter(i => i.current !== 'done').length);
  members = computed(() => this.items().filter(i => i.officeId === this.officeId() && this.config.keyOf(i) === this.groupKey()));
  doneCount = computed(() => this.members().filter(i => i.current === 'done').length);

  stepItems = computed<StepperItem[]>(() => this.config.steps.map((s, k) => {
    const here = this.members().filter(i => i.current === s.key);
    const attention = here.filter(i => itemTone(i) === 'attention').length;
    const waiting = here.filter(i => itemTone(i) === 'waiting').length;
    const yours = here.length - attention - waiting;
    const allPast = this.members().every(i => this.stepIndex(i) > k);
    const parts = [attention ? `${attention}名 要確認` : '', yours ? `${yours}名 あなたの番` : '', waiting ? `${waiting}名 承認待ち` : ''].filter(Boolean);
    return {
      key: s.key, label: s.label,
      state: allPast ? 'done' : attention ? 'attention' : here.length && !yours ? 'waiting' : 'todo',
      note: parts.length ? parts.join('・') : allPast ? '完了' : '—',
      disabled: !here.length,
    };
  }));

  rows = computed<TargetRow[]>(() => this.members()
    .filter(i => !this.stepFilter() || i.current === this.stepFilter())
    .map(i => {
      const tone: StatusTone = itemTone(i);
      return {
        id: i.id, name: i.name, sub: this.config.sub(i), tone,
        statusLabel: tone === 'done' ? '完了' : tone === 'waiting' ? '承認待ち' : tone === 'attention' ? '差し戻し' : this.stepLabel(i.current),
        reason: tone === 'attention' && i.currentDetail ? i.currentDetail : undefined,
      };
    }));

  constructor() {
    // 事業所を切り替えたら読み込み直す（まとめの画面は URL の事業所だけ）
    effect(() => {
      this.office.selected();
      this.groupKey();
      void this.load();
    });
  }

  stepIndex(i: GroupItem) {
    return i.current === 'done' ? this.config.steps.length : this.config.steps.findIndex(s => s.key === i.current);
  }
  stepLabel(key: string) { return this.config.steps.find(s => s.key === key)?.label ?? key; }
  tone = itemTone;
  itemOf(id: string) { return this.items().find(i => i.id === id); }
  officeName(id: string) { return this.office.offices().find(o => o.id === id)?.name ?? ''; }

  toneCounts(items: GroupItem[]) {
    const tones = items.map(itemTone);
    return ([['attention', '要確認'], ['yours', 'あなたの番'], ['waiting', '待ち'], ['done', '完了']] as const)
      .map(([tone, label]) => ({ tone, label, count: tones.filter(t => t === tone).length }))
      .filter(t => t.count > 0);
  }

  openGroup(officeId: string, key: string) {
    this.stepFilter.set(null);
    void this.router.navigate([this.config.route], { queryParams: { officeId, key } });
  }

  openPerson(id: string) {
    void this.router.navigate([this.config.route, id]);
  }

  async load() {
    this.loading.set(true);
    this.error.set('');
    try {
      const officeId = this.groupKey() ? this.officeId() : this.office.selected() || undefined;
      this.items.set(await loadGroupItems(this.functions, this.auth.companyId, this.type, officeId));
    } catch (e) {
      this.error.set(errorMessage(e, '手続きを読み込めませんでした'));
    } finally {
      this.loading.set(false);
    }
  }
}

/**
 * 1人の画面の右上に出す「2 / 6人目 ‹ 前 次 ›」。同じまとめ（事業所×日）の人の間を移る。
 * ウィザードは同じ部品のまま id だけ変わると読み込み直さないため、いったん別の URL を経由して開き直す
 */
@Component({
  selector: 'app-group-nav',
  standalone: true,
  imports: [MatButtonModule],
  template: `
    @if (siblings().length > 1) {
      <span class="nav">
        <span class="count">{{ index() + 1 }} / {{ siblings().length }}人目</span>
        <button mat-stroked-button type="button" (click)="go(-1)" [disabled]="index() <= 0" aria-label="前の人">‹ 前</button>
        <button mat-stroked-button type="button" (click)="go(1)" [disabled]="index() >= siblings().length - 1" aria-label="次の人">次 ›</button>
      </span>
    }
  `,
  styles: [`.nav { display: inline-flex; align-items: center; gap: var(--app-space-2); } .count { font-size: var(--app-font-sm); color: var(--app-color-text-sub); }`],
})
export class GroupNavComponent {
  private functions = inject(Functions);
  private auth = inject(AuthService);
  private router = inject(Router);

  type = input.required<GroupType>();
  officeId = input.required<string>();
  /** まとめの鍵（GROUP_CONFIGS の keyOf と同じ値） */
  groupKey = input.required<string>();
  currentId = input.required<string>();

  siblings = signal<GroupItem[]>([]);
  index = computed(() => this.siblings().findIndex(i => i.id === this.currentId()));

  constructor() {
    effect(() => {
      const [type, officeId, key] = [this.type(), this.officeId(), this.groupKey()];
      if (!officeId) return;
      loadGroupItems(this.functions, this.auth.companyId, type, officeId)
        .then(items => this.siblings.set(items.filter(i => GROUP_CONFIGS[type].keyOf(i) === key)))
        .catch(() => this.siblings.set([])); // 前後の人が分からなくても、この人の手続きは進められる
    });
  }

  async go(delta: number) {
    const next = this.siblings()[this.index() + delta];
    if (!next) return;
    const url = `${GROUP_CONFIGS[this.type()].route}/${next.id}`;
    await this.router.navigateByUrl('/home', { skipLocationChange: true });
    await this.router.navigateByUrl(url);
  }
}
