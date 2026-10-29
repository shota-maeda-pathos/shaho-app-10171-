import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Clipboard } from '@angular/cdk/clipboard';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../core/services/auth.service';
import { OfficeContextService } from '../../core/services/office-context.service';
import {
  BulkAction, BulkRun, EmptyStateComponent, ErrorStateComponent, StatusTone, TargetCellDirective, TargetListComponent, TargetRow,
} from '../../shared/ui';
import { CURRENT_LABELS, errorMessage, inviteUrl, OnboardingListItem, WizardKey } from './onboarding.types';

const TONES: Record<WizardKey, StatusTone> = {
  invite: 'waiting', register: 'yours', contract: 'yours', filing: 'yours',
  approval: 'waiting', submit: 'yours', confirm: 'yours', done: 'done',
};

/**
 * 入社手続きの一覧。新卒の一斉入社のようにまとめて始めた人たちを、同じステップにいる人ごとにまとめて進める。
 * 個人ごとの入力（台帳登録・雇用条件）は、行を開いて1人ずつ行う。
 */
@Component({
  selector: 'app-onboarding-list',
  standalone: true,
  imports: [DatePipe, RouterLink, MatButtonModule, MatIconModule, TargetListComponent, TargetCellDirective, EmptyStateComponent, ErrorStateComponent],
  template: `
    <div class="app-page">
      <div class="head">
        <h1 class="app-page-title">{{ batchId ? 'まとめて始めた入社手続き' : '入社手続き' }}</h1>
        <a mat-flat-button routerLink="/onboarding/new"><mat-icon>person_add</mat-icon>人が入社する</a>
      </div>
      <p class="app-page-guide">
        進行中の入社手続きです。要対応の人（返戻・差し戻しなど）だけを最初に表示しています。
        資格取得届の作成と完了は、同じステップにいる人をまとめて進められます。台帳への登録と雇用条件は、名前を押して1人ずつ入れてください。
        @if (batchId) { <a routerLink="/onboarding">すべての入社手続きを見る</a> }
      </p>

      @if (error()) {
        <app-error-state [message]="error()" (retry)="load()" />
      } @else if (!loading() && items().length === 0) {
        <app-empty-state message="進行中の入社手続きはありません" hint="入社する人がいれば「人が入社する」から始めます。" icon="badge" />
      } @else {
        <app-target-list [rows]="rows()" [actions]="actions" [busy]="busy()" [loading]="loading()" cellHeader="入社日"
                         (run)="run($event)" (retryFailed)="retry($event)" (hold)="hold($event.id, $event.reason)"
                         (release)="hold($event, null)" (open)="open($event.id)">
          <ng-template appTargetCell let-row>
            {{ itemOf(row.id)?.hireDate | date:'yyyy年M月d日' }}
          </ng-template>
        </app-target-list>
      }
    </div>
  `,
  styles: [`
    .head { display: flex; justify-content: space-between; align-items: center; gap: var(--app-space-3); flex-wrap: wrap; }
    a { color: var(--app-color-link); }
    a[mat-flat-button] { color: inherit; }
  `],
})
export class OnboardingListComponent implements OnInit {
  private functions = inject(Functions);
  private auth = inject(AuthService);
  private office = inject(OfficeContextService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private clipboard = inject(Clipboard);
  private snackBar = inject(MatSnackBar);

  batchId = '';
  items = signal<OnboardingListItem[]>([]);
  failures = signal<Record<string, string>>({});
  lastAction = signal('');
  loading = signal(true);
  busy = signal(false);
  error = signal('');

  readonly actions: BulkAction[] = [
    { key: 'filing', label: '資格取得届を作って承認を依頼', appliesTo: r => this.itemOf(r.id)?.current === 'filing' },
    { key: 'complete', label: '完了にする', appliesTo: r => this.itemOf(r.id)?.current === 'confirm' },
    { key: 'links', label: '入力用リンクをまとめてコピー', appliesTo: r => this.itemOf(r.id)?.current === 'invite' && !!this.itemOf(r.id)?.inviteToken },
  ];

  rows = computed<TargetRow[]>(() => this.items().map(i => {
    const returned = !!i.currentDetail && /差戻|返戻/.test(i.currentDetail);
    return {
      id: i.id, name: i.name,
      sub: i.selfInputAt ? '本人の入力あり' : undefined,
      tone: returned ? 'action' : TONES[i.current],
      statusLabel: returned ? `${CURRENT_LABELS[i.current]}（差し戻し）` : CURRENT_LABELS[i.current],
      reason: i.currentDetail && i.currentDetail !== CURRENT_LABELS[i.current] ? i.currentDetail : undefined,
      held: i.hold ?? undefined,
      error: this.failures()[i.id],
    };
  }));

  async ngOnInit() {
    this.batchId = this.route.snapshot.queryParamMap.get('batchId') ?? '';
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
        companyId: this.auth.companyId, ...this.office.params(), ...(this.batchId ? { batchId: this.batchId } : {}),
      });
      this.items.set(data.items);
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
