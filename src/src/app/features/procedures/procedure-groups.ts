import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Clipboard } from '@angular/cdk/clipboard';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../core/services/auth.service';
import { OfficeContextService } from '../../core/services/office-context.service';
import {
  BulkAction, BulkRun, EmptyStateComponent, ErrorStateComponent, LoadingStateComponent, PageHeadComponent, StatusTone, StepLeadComponent,
  StepperComponent, StepperItem, TargetCellDirective, TargetListComponent, TargetRow,
} from '../../shared/ui';
import { errorMessage, inviteUrl, OnboardingListItem, STEP_LABELS } from '../onboarding/onboarding.types';

/** まとめの1行（1人の手続き）。退職・年齢到達は functions/src/procedures/group-list.ts の GroupListItem、入社は onboardingList から作る */
export interface GroupItem {
  id: string; version: number; status: string; name: string; officeId: string;
  date: string | null; kind: string | null; current: string; currentDetail: string | null; returned: boolean;
  /** 待っている相手（「承認待ち」「本人待ち」）。待っていなければ null */
  waitingFor: string | null;
  hold: { reason: string } | null;
  /** 入社：本人の入力用リンク・本人の入力があったか */
  inviteToken?: string | null;
  selfInput?: boolean;
}

export type GroupType = 'onboarding' | 'loss' | 'age_event';

/**
 * 入社・退職・年齢到達の「まとめ」（docs/ui-unification-design.md の3章）。データでは持たず、事業所×日で表示するときに束ねる。
 * 入社＝入社日ごと、退職＝退職日ごと（未入力の人は「退職日 未入力」）、年齢到達＝到達月ごと。
 * 3つとも同じ画面（この部品）を使い、違いはこの設定だけにする。
 */
interface GroupConfig {
  /** 種類（見出しの上のタグ・1人の画面の件名） */
  title: string;
  /** まとめの一覧の件名 */
  listHeading: string;
  route: string;
  steps: { key: string; label: string }[];
  /** まとめの鍵（入社日・退職日・到達月。未入力は none） */
  keyOf: (i: GroupItem) => string;
  groupLabel: (key: string) => string;
  sub: (i: GroupItem) => string | undefined;
  /** まとめの画面の見出しの補足（期限の決まりなど） */
  note?: string;
  /** 一覧の右上の「追加」と、まとめの画面の「この日の人を追加」 */
  add: { label: string; link: string; groupLabel?: string; query?: (officeId: string, key: string) => Record<string, string> };
  /** 1人だけ保留にできるか */
  hold: boolean;
  emptyHint: string;
}

const ymd = (date: string) => { const [y, m, d] = date.split('-').map(Number); return `${y}年${m}月${d}日`; };
const md = (date: string) => { const [, m, d] = date.split('-').map(Number); return `${m}月${d}日`; };

export const GROUP_CONFIGS: Record<GroupType, GroupConfig> = {
  onboarding: {
    title: '入社',
    listHeading: '日ごとのまとめ',
    route: '/onboarding',
    steps: Object.entries(STEP_LABELS).map(([key, label]) => ({ key, label })),
    keyOf: i => i.date ?? 'none',
    groupLabel: key => `${ymd(key)} 入社`,
    sub: i => i.selfInput ? '本人の入力あり' : undefined,
    note: '資格取得届は入社日から5日以内',
    add: { label: '入社する人を追加', link: '/onboarding/new', groupLabel: 'この日に入社する人を追加', query: (officeId, key) => ({ officeId, hireDate: key }) },
    hold: true,
    emptyHint: '入社する人がいれば「入社する人を追加」から始めます。',
  },
  loss: {
    title: '退職',
    listHeading: '日ごとのまとめ',
    route: '/resignation',
    steps: [
      { key: 'entry', label: '退職日' }, { key: 'settlement', label: '最後の保険料' }, { key: 'account', label: 'アカウント' },
      { key: 'filing', label: '届出の作成' }, { key: 'approval', label: '承認' }, { key: 'submit', label: '提出' }, { key: 'confirm', label: '完了の確認' },
    ],
    keyOf: i => i.date ?? 'none',
    groupLabel: key => key === 'none' ? '退職日 未入力' : `${ymd(key)} 退職`,
    sub: () => undefined,
    note: '資格喪失届は退職日の翌日から5日以内',
    add: { label: '手続きを始める', link: '/procedures/new' },
    hold: false,
    emptyHint: '退職する人がいれば「手続きを始める」の「人が退職する」から始めます。',
  },
  age_event: {
    title: '年齢到達',
    listHeading: '月ごとのまとめ',
    route: '/age-events',
    steps: [
      { key: 'check', label: '到達日の確認' }, { key: 'filing', label: '届出の作成' }, { key: 'approval', label: '承認' },
      { key: 'submit', label: '提出' }, { key: 'confirm', label: '完了の確認' },
    ],
    keyOf: i => i.date?.slice(0, 7) ?? 'none',
    groupLabel: key => { const [y, m] = key.split('-').map(Number); return key === 'none' ? '到達日 不明' : `${y}年${m}月 到達`; },
    sub: i => `${i.kind === 'health75' ? '75歳' : '70歳'}・到達日 ${i.date ? md(i.date) : '—'}`,
    note: '届出は資格を失う日から5日以内',
    add: { label: '手続きを始める', link: '/procedures/new' },
    hold: false,
    emptyHint: '70歳・75歳になる人は、ホームのやることや「手続きを始める」から始めます。',
  },
};

/** 1人の画面の戻るリンクの文言（例：「11月1日 入社のまとめ」） */
export function groupBackLabel(type: GroupType, key: string) {
  if (key === 'none') return `${GROUP_CONFIGS[type].groupLabel(key)}のまとめ`;
  if (type === 'age_event') { const [, m] = key.split('-').map(Number); return `${m}月 到達のまとめ`; }
  return `${md(key)} ${GROUP_CONFIGS[type].title}のまとめ`;
}

export function itemTone(i: GroupItem): 'yours' | 'attention' | 'waiting' | 'done' {
  if (i.current === 'done') return 'done';
  if (i.returned) return 'attention';
  if (i.waitingFor) return 'waiting';
  return 'yours';
}

function fromOnboarding(i: OnboardingListItem): GroupItem {
  return {
    id: i.id, version: i.version, status: i.status, name: i.name, officeId: i.officeId, date: i.hireDate, kind: null,
    current: i.current, currentDetail: i.currentDetail, returned: !!i.currentDetail && /差戻|差し戻|返戻/.test(i.currentDetail),
    waitingFor: i.current === 'invite' && i.inviteToken ? '本人待ち' : i.current === 'approval' ? '承認待ち' : null,
    hold: i.hold, inviteToken: i.inviteToken, selfInput: !!i.selfInputAt,
  };
}

async function loadGroupItems(functions: Functions, companyId: string, type: GroupType, officeId?: string) {
  if (type === 'onboarding') {
    const { data } = await httpsCallable<object, { items: OnboardingListItem[] }>(functions, 'onboardingList')({
      companyId, includeCompleted: true, ...(officeId ? { officeId } : {}),
    });
    return data.items.filter(i => i.status !== 'cancelled').map(fromOnboarding);
  }
  const { data } = await httpsCallable<object, { items: (Omit<GroupItem, 'waitingFor' | 'hold'> & { waitingApproval: boolean })[] }>(functions, 'procedureGroupList')({
    companyId, procedureType: type, includeCompleted: true, ...(officeId ? { officeId } : {}),
  });
  return data.items.map(i => ({ ...i, waitingFor: i.waitingApproval ? '承認待ち' : null, hold: null }));
}

/**
 * まとめの一覧（?key がないとき）とまとめの画面（?officeId=&key= のとき）。ルートの data.groupType で種類を選ぶ。
 * まとめの画面は賞与と同じ骨組みで、ステップの数字は人数の内訳、押すと絞り込み、行にミニステップ、名前で1人の画面へ。
 */
@Component({
  selector: 'app-procedure-groups',
  standalone: true,
  imports: [
    FormsModule, RouterLink, MatButtonModule, MatCheckboxModule, MatIconModule, PageHeadComponent, StepperComponent, StepLeadComponent,
    TargetListComponent, TargetCellDirective, EmptyStateComponent, ErrorStateComponent, LoadingStateComponent,
  ],
  template: `
    <div class="app-page">
      @if (!groupKey()) {
        <!-- まとめの一覧 -->
        <app-page-head [heading]="config.listHeading" [kicker]="config.title">
          <ng-container meta>
            <span>進行中 <b>{{ activeCount() }}名</b></span>
            <span>あなたの番 <b>{{ yoursCount() }}名</b></span>
          </ng-container>
          <ng-container actions>
            <mat-checkbox [ngModel]="showDone()" (ngModelChange)="showDone.set($event)">完了したまとめも出す</mat-checkbox>
            <a mat-stroked-button [routerLink]="config.add.link"><mat-icon>add</mat-icon>{{ config.add.label }}</a>
          </ng-container>
        </app-page-head>
        @if (error()) {
          <app-error-state [message]="error()" (retry)="load()" />
        } @else if (loading()) {
          <app-loading-state />
        } @else if (!visibleGroups().length) {
          <app-empty-state [message]="'進行中の' + config.title + 'の手続きはありません'" [hint]="config.emptyHint" icon="event" />
        } @else {
          <section class="panel">
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
                    <td class="go"><mat-icon aria-hidden="true">chevron_right</mat-icon></td>
                  </tr>
                }
              </tbody>
            </table>
            <p class="foot">同じ{{ type === 'age_event' ? '月' : '日' }}・同じ事業所の人は、自動で同じまとめに入ります。1人ずつの手続きは、手続き一覧からも開けます。</p>
          </section>
        }
      } @else {
        <!-- まとめの画面 -->
        <app-page-head [heading]="config.groupLabel(groupKey())" [kicker]="config.title" [backLink]="config.route" [backLabel]="config.title + 'のまとめの一覧'">
          <ng-container meta>
            <span>{{ officeName(officeId()) }}</span>
            <span>対象 <b>{{ members().length }}名</b></span>
            @if (doneCount()) { <span>完了 {{ doneCount() }}名</span> }
            @if (config.note) { <span>{{ config.note }}</span> }
          </ng-container>
          <ng-container actions>
            @if (config.add.groupLabel && groupKey() !== 'none') {
              <a mat-stroked-button [routerLink]="config.add.link" [queryParams]="config.add.query?.(officeId(), groupKey())"><mat-icon>add</mat-icon>{{ config.add.groupLabel }}</a>
            }
            <button mat-stroked-button type="button" (click)="load()" [disabled]="loading() || busy()"><mat-icon>refresh</mat-icon>読み込み直す</button>
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
            <app-target-list [rows]="rows()" [actions]="actions()" [busy]="busy()" [loading]="loading()" cellHeader="進み具合" defaultFilter="all"
                             [allowHold]="config.hold" (run)="run($event)" (retryFailed)="retry($event)"
                             (hold)="hold($event.id, $event.reason)" (release)="hold($event, null)" (open)="openPerson($event.id)">
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
    .panel { padding: var(--app-space-4) var(--app-space-5) var(--app-space-5); border: 1px solid var(--app-color-border); border-radius: var(--app-radius); background: var(--app-color-surface); }
    table.groups { width: 100%; border-collapse: collapse; }
    .groups th { text-align: left; font-size: var(--app-font-xs); font-weight: 600; color: var(--app-color-text-sub); background: var(--app-color-surface-sub); white-space: nowrap; }
    .groups th, .groups td { padding: var(--app-space-2) var(--app-space-3); border-bottom: 1px solid var(--app-color-border); }
    .groups tbody tr { cursor: pointer; }
    .groups tbody tr:hover td { background: #fafbfd; }
    .groups tbody tr:focus-visible { outline: 2px solid var(--app-color-link); outline-offset: -2px; }
    .num { text-align: right; white-space: nowrap; }
    .parts { display: flex; gap: var(--app-space-1); flex-wrap: wrap; }
    .go { text-align: right; color: var(--app-color-text-sub); width: 32px; }
    .foot { margin: var(--app-space-3) 0 0; font-size: var(--app-font-xs); color: var(--app-color-text-sub); }
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
  private clipboard = inject(Clipboard);
  private snackBar = inject(MatSnackBar);

  readonly type = this.route.snapshot.data['groupType'] as GroupType;
  readonly config = GROUP_CONFIGS[this.type];
  private query = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  groupKey = computed(() => this.query().get('key') ?? '');
  officeId = computed(() => this.query().get('officeId') ?? '');

  items = signal<GroupItem[]>([]);
  loading = signal(true);
  busy = signal(false);
  error = signal('');
  showDone = signal(false);
  stepFilter = signal<string | null>(null);
  failures = signal<Record<string, string>>({});
  lastAction = signal('');

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
  yoursCount = computed(() => this.items().filter(i => ['yours', 'attention'].includes(itemTone(i))).length);
  members = computed(() => this.items().filter(i => i.officeId === this.officeId() && this.config.keyOf(i) === this.groupKey()));
  doneCount = computed(() => this.members().filter(i => i.current === 'done').length);

  stepItems = computed<StepperItem[]>(() => this.config.steps.map((s, k) => {
    const here = this.members().filter(i => i.current === s.key);
    const attention = here.filter(i => itemTone(i) === 'attention').length;
    const waiting = here.filter(i => itemTone(i) === 'waiting');
    const yours = here.length - attention - waiting.length;
    const allPast = this.members().every(i => this.stepIndex(i) > k);
    const parts = [
      attention ? `${attention}名 要確認` : '', yours ? `${yours}名 あなたの番` : '', waiting.length ? `${waiting.length}名 ${waiting[0].waitingFor}` : '',
    ].filter(Boolean);
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
        statusLabel: tone === 'done' ? '完了' : tone === 'waiting' ? i.waitingFor! : tone === 'attention' ? '差し戻し' : this.stepLabel(i.current),
        reason: tone === 'attention' && i.currentDetail ? i.currentDetail : undefined,
        held: i.hold ?? undefined,
        error: this.failures()[i.id],
      };
    }));

  /**
   * まとめての操作。1人ずつの入力が要らないステップだけ（退職の資格喪失届は保険証の回収枚数を1人ずつ入れるため、1人の画面で進める）。
   * key はウィザードの更新の関数（onboardingUpdate など）の step。links は入社の入力用リンクのコピー
   */
  actions = computed<BulkAction[]>(() => {
    const at = (step: string) => (r: TargetRow) => this.itemOf(r.id)?.current === step;
    const complete: BulkAction = {
      key: 'complete', label: '手続きを完了する', appliesTo: at('confirm'),
      confirm: { title: `${this.config.title}の手続きを完了する`, message: '提出まで終えた人の手続きを完了にし、やることから外します。', confirmLabel: '完了する' },
    };
    switch (this.type) {
      case 'onboarding': return [
        {
          key: 'filing', label: '資格取得届を作って承認を依頼する', appliesTo: at('filing'),
          caution: '承認を依頼すると、雇用条件と届出は差し戻されるまで直せません。',
          confirm: {
            title: '資格取得届を作って承認を依頼する', message: '雇用条件から決まった等級で資格取得届を作り、別の担当者（管理者・承認者）に承認を依頼します。',
            notice: '依頼中は雇用条件と届出を直せません。資格取得届は入社日から5日以内に提出します。',
          },
        },
        complete,
        { key: 'links', label: '入力用リンクをコピーする', appliesTo: r => at('invite')(r) && !!this.itemOf(r.id)?.inviteToken },
      ];
      case 'age_event': return [
        {
          key: 'filing', label: '届出を作って承認を依頼する', appliesTo: at('filing'),
          caution: '到達日と届出の要否を確かめた人の届出を作ります。依頼中は直せません。',
          confirm: {
            title: '年齢到達の届出を作って承認を依頼する', message: '確かめた内容で届出（70歳到達届・資格喪失届）を作り、別の担当者（管理者・承認者）に承認を依頼します。',
            notice: '届出は資格を失う日から5日以内に提出します。',
          },
        },
        complete,
      ];
      default: return [complete];
    }
  });
  private readonly updateFn = ({ onboarding: 'onboardingUpdate', loss: 'resignationUpdate', age_event: 'ageEventUpdate' } as const)[this.type];

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

  // ---- まとめての操作 ----

  async run(req: BulkRun) {
    this.lastAction.set(req.action);
    if (req.action === 'links') {
      const lines = req.ids.map(id => this.itemOf(id)).filter(i => i?.inviteToken).map(i => `${i!.name}\t${inviteUrl(i!.inviteToken!)}`);
      this.clipboard.copy(lines.join('\n'));
      this.snackBar.open(`${lines.length}名分の入力用リンクをコピーしました（名前とリンクをタブ区切りで1行ずつ）`, '閉じる', { duration: 5000 });
      return;
    }
    await this.runEach(req.action, req.ids);
  }

  retry(ids: string[]) {
    return this.runEach(this.lastAction() || 'filing', ids);
  }

  /** 1人ずつ実行し、失敗した人だけを一覧に残す（成功した人は巻き戻さない） */
  private async runEach(step: string, ids: string[]) {
    this.busy.set(true);
    const failures = { ...this.failures() };
    let ok = 0;
    for (const id of ids) {
      const item = this.itemOf(id);
      if (!item) continue;
      try {
        await httpsCallable(this.functions, this.updateFn)({ companyId: this.auth.companyId, procedureId: id, expectedVersion: item.version, step });
        delete failures[id];
        ok++;
      } catch (e) {
        failures[id] = errorMessage(e, '処理できませんでした');
      }
    }
    this.failures.set(failures);
    this.busy.set(false);
    const failed = ids.filter(id => failures[id]).length;
    this.snackBar.open(failed ? `${ok}名を処理しました。${failed}名は失敗しました（一覧に理由を表示）` : `${ok}名を処理しました`, '閉じる', { duration: 5000 });
    await this.load();
  }

  async hold(id: string, reason: string | null) {
    const item = this.itemOf(id);
    if (!item || !this.config.hold) return;
    try {
      await httpsCallable(this.functions, 'onboardingUpdate')({
        companyId: this.auth.companyId, procedureId: id, expectedVersion: item.version, step: 'hold', reason,
      });
      await this.load();
    } catch (e) {
      this.snackBar.open(errorMessage(e, '保留を変更できませんでした'), '閉じる', { duration: 6000 });
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
