import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Clipboard } from '@angular/cdk/clipboard';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../core/services/auth.service';
import { OfficeContextService } from '../../core/services/office-context.service';
import {
  BulkAction, BulkRun, EmptyStateComponent, ErrorStateComponent, LoadingStateComponent, PageHeadComponent, StepLeadComponent, StepperComponent,
  StepperItem, TargetCellDirective, TargetListComponent, TargetRow,
} from '../../shared/ui';
import {
  CURRENT_LABELS, errorMessage, inviteUrl, itemTone, ONBOARDING_KEYS, OnboardingListItem, STEP_LABELS, waitingFor, WizardKey,
} from './onboarding.types';

type StepKey = Exclude<WizardKey, 'done'>;

/**
 * 入社のまとめ（事業所×入社日）。賞与と同じ骨組みで、ステップの数字は人数の内訳、ステップを押すとそこにいる人に絞り込む。
 * 表の行には1人の小さな進み具合を出し、名前を押すと1人の画面に移る。
 * 本人への入力依頼のリンク・資格取得届の作成と承認依頼・完了は、まとめて行える。
 */
@Component({
  selector: 'app-onboarding-group',
  standalone: true,
  imports: [
    RouterLink, MatButtonModule, MatIconModule, PageHeadComponent, StepperComponent, StepLeadComponent, TargetListComponent, TargetCellDirective,
    EmptyStateComponent, ErrorStateComponent, LoadingStateComponent,
  ],
  template: `
    <div class="app-page">
      <app-page-head [heading]="title()" kicker="入社" backLink="/onboarding" backLabel="入社のまとめの一覧">
        <ng-container meta>
          <span>{{ officeName() }}</span>
          <span>対象 <b>{{ items().length }}名</b></span>
          @if (doneCount()) { <span>完了 {{ doneCount() }}名</span> }
          <span>資格取得届は入社日から5日以内</span>
        </ng-container>
        <ng-container actions>
          <a mat-stroked-button routerLink="/onboarding/new" [queryParams]="{ officeId: officeId, hireDate: date }"><mat-icon>person_add</mat-icon>この日に入社する人を追加</a>
          <button mat-button type="button" (click)="load()" [disabled]="loading() || busy()"><mat-icon>refresh</mat-icon>読み込み直す</button>
        </ng-container>
      </app-page-head>

      @if (error()) {
        <app-error-state [message]="error()" (retry)="load()" />
      } @else if (loading() && !items().length) {
        <app-loading-state message="入社手続きを読み込んでいます…" />
      } @else if (!items().length) {
        <app-empty-state message="この日に入社する人の手続きはありません" hint="「この日に入社する人を追加」から始めます。" icon="badge" />
      } @else {
        <app-stepper [steps]="stepItems()" [current]="stepFilter() ?? ''" label="入社のステップ" (select)="stepFilter.set($any($event))" />

        <section class="panel" aria-labelledby="group-lead">
          <app-step-lead [heading]="stepFilter() ? labels[stepFilter()!] : '全員の進み具合'" [text]="leadText()" headingId="group-lead">
            @if (stepFilter()) { <button right mat-button type="button" (click)="stepFilter.set(null)">全員を表示</button> }
          </app-step-lead>

          <app-target-list [rows]="rows()" [actions]="actions()" [busy]="busy()" [loading]="loading()" cellHeader="進み具合" defaultFilter="all"
                           (run)="run($event)" (retryFailed)="retry($event)" (hold)="hold($event.id, $event.reason)"
                           (release)="hold($event, null)" (open)="open($event.id)">
            <ng-template appTargetCell let-row>
              @if (itemOf(row.id); as i) {
                <span class="mini" [attr.aria-label]="'ステップ ' + (stepIndex(i) + 1) + ' / ' + keys.length">
                  @for (k of keys; track k; let n = $index) {
                    <i [class.d]="n < stepIndex(i)" [class.c]="n === stepIndex(i) && i.current !== 'done'" [class.w]="n === stepIndex(i) && toneOf(i) === 'waiting'"></i>
                  }
                </span>
                <div class="sub">{{ stepName(i) }}</div>
              }
            </ng-template>
          </app-target-list>
        </section>
      }
    </div>
  `,
  styles: [`
    .panel { padding: var(--app-space-4) var(--app-space-5) var(--app-space-5); border: 1px solid var(--app-color-border); border-radius: var(--app-radius); background: var(--app-color-surface); }
    .mini { display: inline-flex; gap: 3px; align-items: center; }
    .mini i { width: 14px; height: 4px; border-radius: 2px; background: var(--app-color-border); }
    .mini i.d { background: var(--app-status-done-fg); }
    .mini i.c { background: var(--app-status-yours-fg); }
    .mini i.w { background: var(--app-status-waiting-fg); }
    .sub { margin-top: 3px; font-size: var(--app-font-xs); color: var(--app-color-text-sub); }
  `],
})
export class OnboardingGroupComponent implements OnInit {
  private functions = inject(Functions);
  private auth = inject(AuthService);
  private office = inject(OfficeContextService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private clipboard = inject(Clipboard);
  private snackBar = inject(MatSnackBar);

  readonly keys = ONBOARDING_KEYS;
  readonly labels = STEP_LABELS;
  officeId = '';
  date = '';
  items = signal<OnboardingListItem[]>([]);
  failures = signal<Record<string, string>>({});
  lastAction = signal('');
  loading = signal(true);
  busy = signal(false);
  error = signal('');
  /** ステップを押したときの絞り込み（null は全員） */
  stepFilter = signal<StepKey | null>(null);

  title = computed(() => {
    const [y, m, d] = this.date.split('-').map(Number);
    return y ? `${y}年${m}月${d}日 入社` : '入社';
  });
  officeName = computed(() => this.office.offices().find(o => o.id === this.officeId)?.name ?? '');
  doneCount = computed(() => this.items().filter(i => i.current === 'done').length);

  stepIndex(i: OnboardingListItem) {
    return i.current === 'done' ? ONBOARDING_KEYS.length : ONBOARDING_KEYS.indexOf(i.current);
  }
  toneOf = itemTone;
  stepName(i: OnboardingListItem) {
    return i.current === 'done' ? '完了' : STEP_LABELS[i.current];
  }

  /** ステップの数字は、そのステップにいる人数の内訳（例：「2名 あなたの番・1名 本人待ち」） */
  stepItems = computed<StepperItem[]>(() => ONBOARDING_KEYS.map((key, k) => {
    const here = this.items().filter(i => i.current === key);
    const attention = here.filter(i => itemTone(i) === 'attention').length;
    const waiting = here.filter(i => itemTone(i) === 'waiting');
    const yours = here.length - attention - waiting.length;
    const allPast = this.items().every(i => this.stepIndex(i) > k);
    const parts = [
      attention ? `${attention}名 要確認` : '',
      yours ? `${yours}名 あなたの番` : '',
      waiting.length ? `${waiting.length}名 ${waitingFor(waiting[0])}` : '',
    ].filter(Boolean);
    return {
      key, label: STEP_LABELS[key],
      state: allPast ? 'done' : attention ? 'attention' : here.length && !yours ? 'waiting' : 'todo',
      note: parts.length ? parts.join('・') : allPast ? '完了' : '—',
      disabled: !here.length,
    };
  }));

  leadText = computed(() => {
    const step = this.stepFilter();
    if (step) return `このステップにいる人です。名前を押すと1人の画面で続きを進めます。`;
    return '同じ日に入社する人の手続きです。名前を押すと1人の画面に移ります。資格取得届の作成と完了はまとめて行えます。';
  });

  rows = computed<TargetRow[]>(() => this.items()
    .filter(i => !this.stepFilter() || i.current === this.stepFilter())
    .map(i => {
      const tone = itemTone(i);
      return {
        id: i.id, name: i.name,
        sub: i.selfInputAt ? '本人の入力あり' : undefined,
        tone,
        statusLabel: tone === 'attention' ? `${CURRENT_LABELS[i.current]}（差し戻し）` : tone === 'waiting' ? waitingFor(i) : CURRENT_LABELS[i.current],
        // 差し戻し・返戻の理由だけ出す（ほかの statusDetail は手続きの古い進み具合の文言のことがある）
        reason: tone === 'attention' && i.currentDetail ? i.currentDetail : undefined,
        held: i.hold ?? undefined,
        error: this.failures()[i.id],
      };
    }));

  actions = computed<BulkAction[]>(() => [
    {
      key: 'filing', label: '資格取得届を作って承認を依頼する', appliesTo: r => this.itemOf(r.id)?.current === 'filing',
      caution: '承認を依頼すると、雇用条件と届出は差し戻されるまで直せません。',
      confirm: {
        title: '資格取得届を作って承認を依頼する', message: '雇用条件から決まった等級で資格取得届を作り、別の担当者（管理者・承認者）に承認を依頼します。',
        notice: '依頼中は雇用条件と届出を直せません。資格取得届は入社日から5日以内に提出します。',
      },
    },
    {
      key: 'complete', label: '手続きを完了する', appliesTo: r => this.itemOf(r.id)?.current === 'confirm',
      confirm: { title: '入社の手続きを完了する', message: '提出まで終えた人の手続きを完了にし、やることから外します。', confirmLabel: '完了する' },
    },
    { key: 'links', label: '入力用リンクをコピーする', appliesTo: r => this.itemOf(r.id)?.current === 'invite' && !!this.itemOf(r.id)?.inviteToken },
  ]);

  async ngOnInit() {
    const q = this.route.snapshot.queryParamMap;
    this.officeId = q.get('officeId') ?? '';
    this.date = q.get('date') ?? '';
    await this.load();
  }

  itemOf(id: string) {
    return this.items().find(i => i.id === id);
  }

  async load() {
    this.loading.set(true);
    this.error.set('');
    try {
      const { data } = await httpsCallable<object, { items: OnboardingListItem[] }>(this.functions, 'onboardingList')({
        companyId: this.auth.companyId, officeId: this.officeId, hireDate: this.date, includeCompleted: true,
      });
      this.items.set(data.items.filter(i => i.hireDate === this.date && i.status !== 'cancelled'));
    } catch (e) {
      this.error.set(errorMessage(e, '入社手続きを読み込めませんでした'));
    } finally {
      this.loading.set(false);
    }
  }

  open(id: string) {
    void this.router.navigate(['/onboarding', id]);
  }

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
        await httpsCallable(this.functions, 'onboardingUpdate')({
          companyId: this.auth.companyId, procedureId: id, expectedVersion: item.version, step,
        });
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
    if (!item) return;
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
