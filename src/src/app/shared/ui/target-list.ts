import { Component, Directive, TemplateRef, computed, contentChild, inject, input, linkedSignal, output, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { firstValueFrom } from 'rxjs';
import { ConfirmService } from '../confirm-dialog/confirm-dialog';
import { StatusBadgeComponent, StatusTone, needsMe } from './status-badge';
import { EmptyStateComponent, LoadingStateComponent } from './page-state';
import { ActionBarComponent, SidePanelComponent } from './procedure-frame';
import { TermComponent } from './term';

/** 対象者一覧の1行（1人分） */
export interface TargetRow {
  id: string;
  name: string;
  /** 社員番号など */
  sub?: string;
  tone: StatusTone;
  /** 状態の文字（例：「保険料 未計算」） */
  statusLabel: string;
  /** 要確認の理由など */
  reason?: string;
  /** 保留中なら理由。保留の人は一括操作の対象にしない */
  held?: { reason: string };
  /** 直前の一括操作で失敗した理由 */
  error?: string;
}

/** 一括操作。appliesTo を省略すると保留以外の全員が対象 */
export interface BulkAction {
  /** 文言は次に起こることが分かるように書く（例：「承認を依頼する」）。人数は部品が足す */
  key: string;
  label: string;
  appliesTo?: (row: TargetRow) => boolean;
  /** 主ボタンのときに操作バーへ出す注意の1行 */
  caution?: string;
  /** 選んだ人だけに行う操作（無給の記録など、全員にまとめて行うものではない操作） */
  selectedOnly?: boolean;
  /** 取り返しのつかない操作は、確認ダイアログを通す（対象の人数と名前は部品が足す） */
  confirm?: { title: string; message: string; notice?: string; confirmLabel?: string };
}

export interface BulkRun {
  action: string;
  ids: string[];
}

export type TargetFilter = 'attention' | 'held' | 'ok' | 'all';
type Filter = TargetFilter;

/** 行ごとの独自の列（給与額など）。<ng-template appTargetCell let-row> で渡す */
@Directive({ selector: 'ng-template[appTargetCell]', standalone: true })
export class TargetCellDirective {
  template = inject<TemplateRef<{ $implicit: TargetRow }>>(TemplateRef);
}

/** 右のパネルに出す1人分の内訳。<ng-template appTargetDetail let-row> で渡すと、名前を押したときにパネルが開く */
@Directive({ selector: 'ng-template[appTargetDetail]', standalone: true })
export class TargetDetailDirective {
  template = inject<TemplateRef<{ $implicit: TargetRow }>>(TemplateRef);
}

/**
 * 多人数の手続きの「対象者の表」と下の操作バー（docs/ui-unification-design.md の1・4章）。
 * 絞り込みのチップ（要確認・保留・問題なし・すべて）に人数を出し、既定では要確認の人だけを表示する。
 * 名前を押すと右のパネルに1人分の内訳（appTargetDetail）を出す。渡さなければ open を出す。
 * 操作は run・hold・release・retryFailed を出すだけで、実行と行の更新は呼び出し側が行う。
 * 操作バーには一括操作のボタンが並び、対象のいる先頭の操作が主ボタンになる。ページ独自のボタンは [barActions] で渡す。
 */
@Component({
  selector: 'app-target-list',
  standalone: true,
  imports: [
    NgTemplateOutlet, FormsModule, MatButtonModule, MatCheckboxModule, MatIconModule, MatMenuModule, MatProgressSpinnerModule,
    StatusBadgeComponent, EmptyStateComponent, LoadingStateComponent, TermComponent, ActionBarComponent, SidePanelComponent,
  ],
  template: `
    @if (failed().length > 0) {
      <div class="failed" role="alert">
        <mat-icon aria-hidden="true">error</mat-icon>
        <span>{{ failed().length }}名の処理が失敗しました。理由を確認してから、失敗した人だけをもう一度実行できます。</span>
        <button mat-stroked-button type="button" (click)="retryFailed.emit(failedIds())" [disabled]="busy()">
          <mat-icon>replay</mat-icon> 失敗した人だけ再実行
        </button>
      </div>
    }

    <div class="toolbar">
      <input class="search" type="search" [ngModel]="query()" (ngModelChange)="query.set($event)" placeholder="氏名・社員番号で探す" aria-label="氏名・社員番号で探す">
      <span class="grow"></span>
      <div class="chips" role="group" aria-label="絞り込み">
        @for (c of visibleChips(); track c.key) {
          <button type="button" class="chip" [class.on]="filter() === c.key" [attr.data-tone]="c.tone" [attr.aria-pressed]="filter() === c.key" (click)="filter.set(c.key)">
            {{ c.label }} <span class="n">{{ c.count }}</span>
          </button>
        }
      </div>
    </div>
    @if (hasMore()) {
      <p class="note">人数は読み込み済みの {{ rows().length }} 名の内訳です。</p>
    }

    <div class="table-wrap">
      <table class="target-table">
        <thead>
          <tr>
            @if (actions().length) {
            <th class="col-check">
              <mat-checkbox [checked]="allVisibleSelected()" [indeterminate]="someVisibleSelected()"
                            [disabled]="selectable().length === 0" (change)="toggleAllVisible($event.checked)"
                            aria-label="表示中の人をすべて選ぶ"></mat-checkbox>
            </th>
            }
            <th>従業員</th>
            @if (cell()) { <th>{{ cellHeader() }}</th> }
            <th>状態</th>
            @if (allowHold()) { <th class="col-menu"><span class="visually-hidden">個別の操作</span></th> }
          </tr>
        </thead>
        <tbody>
          @for (row of visible(); track row.id) {
            <tr [class.is-held]="row.held" [class.is-failed]="row.error" [class.is-open]="panelRow()?.id === row.id" [class.is-selected]="selected().has(row.id)">
              @if (actions().length) {
              <td class="col-check">
                <mat-checkbox [checked]="selected().has(row.id)" [disabled]="!!row.held" (change)="toggle(row.id)"
                              [attr.aria-label]="row.name + 'を選ぶ'"></mat-checkbox>
              </td>
              }
              <td>
                <button type="button" class="name" (click)="openRow(row)">{{ row.name }}</button>
                @if (row.sub) { <div class="sub">{{ row.sub }}</div> }
              </td>
              @if (cell(); as c) { <td><ng-container *ngTemplateOutlet="c.template; context: { $implicit: row }" /></td> }
              <td>
                @if (row.held) {
                  <app-status-badge tone="waiting" label="保留中" />
                  <div class="sub">理由：{{ row.held.reason }}</div>
                } @else {
                  <app-status-badge [tone]="row.error ? 'error' : row.tone" [label]="row.statusLabel" />
                  @if (row.reason) { <div class="sub">{{ row.reason }}</div> }
                }
                @if (row.error) { <div class="error">失敗：{{ row.error }}</div> }
              </td>
              @if (allowHold()) {
              <td class="col-menu">
                <button mat-icon-button type="button" [matMenuTriggerFor]="rowMenu" [attr.aria-label]="row.name + 'の操作'" [disabled]="busy()">
                  <mat-icon>more_vert</mat-icon>
                </button>
                <mat-menu #rowMenu="matMenu">
                  <button mat-menu-item type="button" (click)="openRow(row)"><mat-icon>open_in_new</mat-icon>内訳を見る</button>
                  @if (allowHold()) {
                    @if (row.held) {
                      <button mat-menu-item type="button" (click)="release.emit(row.id)"><mat-icon>play_arrow</mat-icon>保留を解除する</button>
                    } @else {
                      <button mat-menu-item type="button" (click)="askHold(row)"><mat-icon>pause</mat-icon>保留にする</button>
                    }
                  }
                </mat-menu>
              </td>
              }
            </tr>
          }
        </tbody>
      </table>
      @if (loading()) {
        <app-loading-state />
      } @else if (visible().length === 0) {
        <app-empty-state [message]="emptyMessage()" icon="task_alt" />
      }
    </div>
    <div class="table-foot">
      @if (detail()) { 名前を押すと、1人分の内訳が右に開きます。 }
      @if (allowHold()) { 1人だけ止めたいときは、行の右端のメニューから<app-term key="hold" />にしてください。他の人の処理は止まりません。 }
      @if (hasMore() && !loading()) { <button mat-stroked-button type="button" (click)="loadMore.emit()">さらに読み込む</button> }
    </div>

    @if (actions().length || emptyInfo()) {
    <app-action-bar [notice]="primaryAction()?.caution">
      <span info>
        @if (selected().size > 0) {
          <b>{{ selected().size }}名</b>を選択中 <button mat-button type="button" class="clear" (click)="clearSelection()">選択を外す</button>
        } @else {
          {{ idleInfo() }}
        }
      </span>
      <ng-content select="[barActions]" />
      @for (a of secondaryActions(); track a.key) {
        <button mat-stroked-button type="button" (click)="runAction(a)" [disabled]="busy() || targetsOf(a).length === 0">
          {{ a.label }}（{{ targetsOf(a).length }}名）
        </button>
      }
      @if (primaryAction(); as a) {
        <button mat-flat-button type="button" (click)="runAction(a)" [disabled]="busy() || targetsOf(a).length === 0">
          @if (busy()) { <mat-spinner diameter="18"></mat-spinner> }
          {{ a.label }}（{{ targetsOf(a).length }}名）<mat-icon iconPositionEnd>arrow_forward</mat-icon>
        </button>
      }
    </app-action-bar>
    }

    @if (detail(); as d) {
      <app-side-panel [open]="!!panelRow()" (openChange)="!$event && panelId.set(null)" [heading]="panelRow()?.name ?? ''" [kicker]="panelRow()?.sub"
                      [position]="panelIndex() + 1" [total]="visible().length" (prev)="step(-1)" (next)="step(1)">
        @if (panelRow(); as row) {
          <ng-container *ngTemplateOutlet="d.template; context: { $implicit: row }" />
        }
        <ng-container ngProjectAs="[panelFoot]">
          @if (panelRow(); as row) {
            @if (row.held) {
              <button mat-stroked-button type="button" (click)="release.emit(row.id)" [disabled]="busy()">保留を解除する</button>
            } @else {
              <button mat-stroked-button type="button" (click)="askHold(row)" [disabled]="busy()">保留にする</button>
            }
          }
        </ng-container>
      </app-side-panel>
    }
  `,
  styleUrl: './target-list.scss',
})
export class TargetListComponent {
  private dialog = inject(MatDialog);
  private confirmService = inject(ConfirmService);

  rows = input.required<TargetRow[]>();
  /** 一括操作。対象がいる操作のうち先頭のものが主ボタンになる */
  actions = input<BulkAction[]>([]);
  loading = input(false);
  busy = input(false);
  hasMore = input(false);
  /** 独自の列の見出し */
  cellHeader = input('');
  /** 「あなたの番」の人も要確認のチップに数える（毎月の処理のように、全員にまとめて操作する手続き） */
  includeYours = input(false);
  /** 一括操作がないときの操作バーの文言 */
  emptyInfo = input('');
  /** 1人だけ保留にできるか（できない画面ではメニューと案内を出さない） */
  allowHold = input(true);
  /** 最初に選ぶ絞り込み。まとめの画面のように全員を見せたいときは all */
  defaultFilter = input<Filter>('attention');

  run = output<BulkRun>();
  hold = output<{ id: string; reason: string }>();
  release = output<string>();
  retryFailed = output<string[]>();
  open = output<TargetRow>();
  loadMore = output<void>();

  cell = contentChild(TargetCellDirective);
  detail = contentChild(TargetDetailDirective);
  filter = linkedSignal<Filter>(() => this.defaultFilter());
  query = signal('');
  selected = signal<ReadonlySet<string>>(new Set());
  panelId = signal<string | null>(null);

  // 失敗した人は、保留中でも要確認に出す（失敗の理由を見つけられるように）。人数が重ならないよう保留中からは外す
  attention = computed(() => this.rows().filter(r => r.error || (!r.held && this.needsAction(r))));
  held = computed(() => this.rows().filter(r => r.held && !r.error));
  ok = computed(() => this.rows().filter(r => !r.held && !this.needsAction(r) && !r.error));
  failed = computed(() => this.rows().filter(r => r.error));
  failedIds = computed(() => this.failed().map(r => r.id));
  chips = computed(() => [
    { key: 'attention' as const, label: '要対応', count: this.attention().length, tone: 'attention' },
    { key: 'held' as const, label: '保留', count: this.held().length, tone: 'waiting' },
    { key: 'ok' as const, label: '問題なし', count: this.ok().length, tone: 'done' },
    { key: 'all' as const, label: 'すべて', count: this.rows().length, tone: '' },
  ]);
  visible = computed(() => {
    const base = (() => {
      switch (this.filter()) {
        case 'attention': return this.attention();
        case 'held': return this.held();
        case 'ok': return this.ok();
        default: return this.rows();
      }
    })();
    const q = this.query().trim().toLowerCase();
    return q ? base.filter(r => r.name.toLowerCase().includes(q) || (r.sub ?? '').toLowerCase().includes(q)) : base;
  });
  selectable = computed(() => this.visible().filter(r => !r.held));
  allVisibleSelected = computed(() => this.selectable().length > 0 && this.selectable().every(r => this.selected().has(r.id)));
  someVisibleSelected = computed(() => !this.allVisibleSelected() && this.selectable().some(r => this.selected().has(r.id)));
  /** 主ボタンは1つだけ。次にやるべき操作（対象がいる先頭の操作）を主ボタンにする */
  primaryAction = computed(() => this.actions().find(a => this.targetsOf(a).length > 0) ?? this.actions()[0] ?? null);
  /** 主ボタン以外は、対象がいるときだけ出す */
  secondaryActions = computed(() => this.actions().filter(a => a !== this.primaryAction() && this.targetsOf(a).length > 0));
  idleInfo = computed(() => this.emptyInfo() || (this.actions().length
    ? '未選択なら対象の全員（保留を除く）'
    : ''));
  /** 保留を使わない画面では、保留のチップも出さない */
  visibleChips = computed(() => this.allowHold() ? this.chips() : this.chips().filter(c => c.key !== 'held'));
  emptyMessage = computed(() => this.query().trim() ? '探している人は、この絞り込みにはいません'
    : ({ attention: 'いま対応が必要な人はいません', held: '保留中の人はいません', ok: '問題のない人はまだいません', all: '対象の人はいません' })[this.filter()]);
  /** パネルで開いている人（表から消えたら、読み込み直した行で開き続ける） */
  panelRow = computed(() => { const id = this.panelId(); return id ? this.rows().find(r => r.id === id) ?? null : null; });
  panelIndex = computed(() => this.visible().findIndex(r => r.id === this.panelId()));

  private needsAction(r: TargetRow) {
    return r.tone !== 'yours' ? needsMe(r.tone) : this.includeYours();
  }

  /** 操作の対象：選んだ人がいれば選んだ人、いなければ全員。どちらも保留中と対象外の人は除く */
  targetsOf(action: BulkAction) {
    const sel = this.selected();
    if (action.selectedOnly && sel.size === 0) return [];
    return this.rows().filter(r =>
      !r.held && (sel.size === 0 || sel.has(r.id)) && (action.appliesTo?.(r) ?? true));
  }

  async runAction(action: BulkAction) {
    const targets = this.targetsOf(action);
    if (action.confirm) {
      const ok = await this.confirmService.ask({
        title: action.confirm.title, message: action.confirm.message, notice: action.confirm.notice,
        count: `${targets.length}名`, items: targets.map(r => r.sub ? `${r.name}（${r.sub}）` : r.name),
        confirmLabel: action.confirm.confirmLabel ?? `${action.label}（${targets.length}名）`,
      });
      if (!ok) return;
    }
    this.run.emit({ action: action.key, ids: targets.map(r => r.id) });
    this.clearSelection();
  }

  openRow(row: TargetRow) {
    if (this.detail()) this.panelId.set(row.id);
    else this.open.emit(row);
  }

  step(delta: number) {
    const next = this.visible()[this.panelIndex() + delta];
    if (next) this.panelId.set(next.id);
  }

  toggle(id: string) {
    const next = new Set(this.selected());
    if (next.has(id)) next.delete(id); else next.add(id);
    this.selected.set(next);
  }

  toggleAllVisible(checked: boolean) {
    const next = new Set(this.selected());
    for (const r of this.selectable()) {
      if (checked) next.add(r.id); else next.delete(r.id);
    }
    this.selected.set(next);
  }

  clearSelection() {
    this.selected.set(new Set());
  }

  async askHold(row: TargetRow) {
    const reason = await firstValueFrom(this.dialog.open(HoldReasonDialogComponent, { data: { name: row.name }, width: '440px' }).afterClosed());
    if (typeof reason === 'string' && reason.trim()) {
      const next = new Set(this.selected());
      next.delete(row.id);
      this.selected.set(next);
      this.hold.emit({ id: row.id, reason: reason.trim() });
    }
  }
}

/** 保留の理由を入力するダイアログ */
@Component({
  selector: 'app-hold-reason-dialog',
  standalone: true,
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  template: `
    <h2 mat-dialog-title>{{ data.name }}を保留にする</h2>
    <mat-dialog-content>
      <p>保留にした人は、まとめて行う操作の対象から外れます。理由はあとで見返せるように残します。</p>
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>保留の理由</mat-label>
        <textarea matInput [(ngModel)]="reason" rows="3" maxlength="200" required
                  placeholder="例：通勤手当の金額を本人に確認中"></textarea>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">やめる</button>
      <button mat-flat-button type="button" [mat-dialog-close]="reason" [disabled]="!reason.trim()">保留にする</button>
    </mat-dialog-actions>
  `,
  styles: [`.full-width { width: 100%; } p { line-height: 1.7; }`],
})
export class HoldReasonDialogComponent {
  data = inject<{ name: string }>(MAT_DIALOG_DATA);
  reason = '';
}
