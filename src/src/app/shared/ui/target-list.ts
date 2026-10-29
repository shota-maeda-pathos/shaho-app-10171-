import { Component, Directive, TemplateRef, computed, contentChild, inject, input, output, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { firstValueFrom } from 'rxjs';
import { StatusBadgeComponent, StatusTone } from './status-badge';
import { EmptyStateComponent, LoadingStateComponent } from './page-state';
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
  /** 要対応の理由など */
  reason?: string;
  /** 保留中なら理由。保留の人は一括操作の対象にしない */
  held?: { reason: string };
  /** 直前の一括操作で失敗した理由 */
  error?: string;
}

/** 一括操作。appliesTo を省略すると保留以外の全員が対象 */
export interface BulkAction {
  key: string;
  label: string;
  appliesTo?: (row: TargetRow) => boolean;
}

export interface BulkRun {
  action: string;
  ids: string[];
}

type Filter = 'attention' | 'held' | 'ok' | 'all';

/** 行ごとの独自の列（給与額など）。<ng-template appTargetCell let-row> で渡す */
@Directive({ selector: 'ng-template[appTargetCell]', standalone: true })
export class TargetCellDirective {
  template = inject<TemplateRef<{ $implicit: TargetRow }>>(TemplateRef);
}

/**
 * 一括型の手続きの「対象者一覧」。
 * 既定では要対応の人だけを表示し、問題のない人は件数だけを出す。
 * 操作は run・hold・release・retryFailed を出すだけで、実行と行の更新は呼び出し側が行う。
 */
@Component({
  selector: 'app-target-list',
  standalone: true,
  imports: [
    NgTemplateOutlet, FormsModule, MatButtonModule, MatButtonToggleModule, MatCheckboxModule,
    MatIconModule, MatMenuModule, StatusBadgeComponent, EmptyStateComponent, LoadingStateComponent, TermComponent,
  ],
  template: `
    <div class="summary" role="group" aria-label="人数の内訳">
      <button type="button" class="summary-item" data-tone="action" [class.active]="filter() === 'attention'" (click)="filter.set('attention')">
        <span class="summary-count">{{ attention().length }}名</span><span>要対応</span>
      </button>
      <button type="button" class="summary-item" data-tone="waiting" [class.active]="filter() === 'held'" (click)="filter.set('held')">
        <span class="summary-count">{{ held().length }}名</span><span>保留中</span>
      </button>
      <button type="button" class="summary-item" data-tone="done" [class.active]="filter() === 'ok'" (click)="filter.set('ok')">
        <span class="summary-count">{{ ok().length }}名</span><span>問題なし</span>
      </button>
      <button type="button" class="summary-item" [class.active]="filter() === 'all'" (click)="filter.set('all')">
        <span class="summary-count">{{ rows().length }}名</span><span>すべて</span>
      </button>
    </div>
    @if (hasMore()) {
      <p class="note">人数は読み込み済みの {{ rows().length }} 名の内訳です。</p>
    }

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
      <span class="selection">
        @if (selected().size > 0) {
          {{ selected().size }}名を選択中 <button mat-button type="button" (click)="clearSelection()">選択を外す</button>
        } @else {
          操作は、選んだ人がいなければ対象の全員に行います（保留中の人は除きます）
        }
      </span>
      <span class="actions">
        @for (a of actions(); track a.key) {
          @if (a.key === primaryKey()) {
            <button mat-flat-button type="button" (click)="runAction(a)" [disabled]="busy() || targetsOf(a).length === 0">
              {{ a.label }}（{{ targetsOf(a).length }}名）
            </button>
          } @else {
            <button mat-stroked-button type="button" (click)="runAction(a)" [disabled]="busy() || targetsOf(a).length === 0">
              {{ a.label }}（{{ targetsOf(a).length }}名）
            </button>
          }
        }
      </span>
    </div>

    <div class="table-wrap">
      <table class="target-table">
        <thead>
          <tr>
            <th class="col-check">
              <mat-checkbox [checked]="allVisibleSelected()" [indeterminate]="someVisibleSelected()"
                            [disabled]="selectable().length === 0" (change)="toggleAllVisible($event.checked)"
                            aria-label="表示中の人をすべて選ぶ"></mat-checkbox>
            </th>
            <th>従業員</th>
            @if (cell()) { <th>{{ cellHeader() }}</th> }
            <th>状態</th>
            <th class="col-menu"><span class="visually-hidden">個別の操作</span></th>
          </tr>
        </thead>
        <tbody>
          @for (row of visible(); track row.id) {
            <tr [class.is-held]="row.held" [class.is-failed]="row.error">
              <td class="col-check">
                <mat-checkbox [checked]="selected().has(row.id)" [disabled]="!!row.held" (change)="toggle(row.id)"
                              [attr.aria-label]="row.name + 'を選ぶ'"></mat-checkbox>
              </td>
              <td>
                <button type="button" class="name" (click)="open.emit(row)">{{ row.name }}</button>
                @if (row.sub) { <div class="sub">{{ row.sub }}</div> }
              </td>
              @if (cell(); as c) { <td><ng-container *ngTemplateOutlet="c.template; context: { $implicit: row }" /></td> }
              <td>
                @if (row.held) {
                  <app-status-badge tone="waiting" label="保留中" />
                  <div class="sub">理由：{{ row.held.reason }}</div>
                } @else {
                  <app-status-badge [tone]="row.error ? 'action' : row.tone" [label]="row.statusLabel" />
                  @if (row.reason) { <div class="sub">{{ row.reason }}</div> }
                }
                @if (row.error) { <div class="error">失敗：{{ row.error }}</div> }
              </td>
              <td class="col-menu">
                <button mat-icon-button type="button" [matMenuTriggerFor]="rowMenu" [attr.aria-label]="row.name + 'の操作'" [disabled]="busy()">
                  <mat-icon>more_vert</mat-icon>
                </button>
                <mat-menu #rowMenu="matMenu">
                  <button mat-menu-item type="button" (click)="open.emit(row)"><mat-icon>open_in_new</mat-icon>詳細を開く</button>
                  @if (row.held) {
                    <button mat-menu-item type="button" (click)="release.emit(row.id)"><mat-icon>play_arrow</mat-icon>保留を解除する</button>
                  } @else {
                    <button mat-menu-item type="button" (click)="askHold(row)"><mat-icon>pause</mat-icon>保留にする</button>
                  }
                </mat-menu>
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>

    @if (loading()) {
      <app-loading-state />
    } @else if (visible().length === 0) {
      <app-empty-state [message]="emptyMessage()" icon="task_alt" />
    }
    @if (hasMore() && !loading()) {
      <div class="more"><button mat-stroked-button type="button" (click)="loadMore.emit()">さらに読み込む</button></div>
    }
    <p class="note">1人だけ止めたいときは、行の右端のメニューから<app-term key="hold" />にしてください。他の人の処理は止まりません。</p>
  `,
  styleUrl: './target-list.scss',
})
export class TargetListComponent {
  private dialog = inject(MatDialog);

  rows = input.required<TargetRow[]>();
  /** 一括操作。対象がいる操作のうち先頭のものが主ボタンになる */
  actions = input<BulkAction[]>([]);
  loading = input(false);
  busy = input(false);
  hasMore = input(false);
  /** 独自の列の見出し */
  cellHeader = input('');
  /** 「あなたの番」の人も要対応に数える（毎月の処理のように、全員にまとめて操作する手続き） */
  includeYours = input(false);

  run = output<BulkRun>();
  hold = output<{ id: string; reason: string }>();
  release = output<string>();
  retryFailed = output<string[]>();
  open = output<TargetRow>();
  loadMore = output<void>();

  cell = contentChild(TargetCellDirective);
  filter = signal<Filter>('attention');
  selected = signal<ReadonlySet<string>>(new Set());

  // 失敗した人は、保留中でも要対応に出す（失敗の理由を見つけられるように）。人数が重ならないよう保留中からは外す
  attention = computed(() => this.rows().filter(r => r.error || (!r.held && this.needsAction(r))));
  held = computed(() => this.rows().filter(r => r.held && !r.error));
  ok = computed(() => this.rows().filter(r => !r.held && !this.needsAction(r) && !r.error));
  failed = computed(() => this.rows().filter(r => r.error));
  failedIds = computed(() => this.failed().map(r => r.id));
  visible = computed(() => {
    switch (this.filter()) {
      case 'attention': return this.attention();
      case 'held': return this.held();
      case 'ok': return this.ok();
      default: return this.rows();
    }
  });
  selectable = computed(() => this.visible().filter(r => !r.held));
  allVisibleSelected = computed(() => this.selectable().length > 0 && this.selectable().every(r => this.selected().has(r.id)));
  someVisibleSelected = computed(() => !this.allVisibleSelected() && this.selectable().some(r => this.selected().has(r.id)));
  /** 主ボタンは1つだけ。次にやるべき操作（対象がいる先頭の操作）を主ボタンにする */
  primaryKey = computed(() => (this.actions().find(a => this.targetsOf(a).length > 0) ?? this.actions()[0])?.key);
  emptyMessage = computed(() => ({
    attention: '要対応の人はいません',
    held: '保留中の人はいません',
    ok: '問題のない人はまだいません',
    all: '対象の人はいません',
  })[this.filter()]);

  private needsAction(r: TargetRow) {
    return r.tone === 'action' || (this.includeYours() && r.tone === 'yours');
  }

  /** 操作の対象：選んだ人がいれば選んだ人、いなければ全員。どちらも保留中と対象外の人は除く */
  targetsOf(action: BulkAction) {
    const sel = this.selected();
    return this.rows().filter(r =>
      !r.held && (sel.size === 0 || sel.has(r.id)) && (action.appliesTo?.(r) ?? true));
  }

  runAction(action: BulkAction) {
    this.run.emit({ action: action.key, ids: this.targetsOf(action).map(r => r.id) });
    this.clearSelection();
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
