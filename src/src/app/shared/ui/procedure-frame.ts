import { Component, HostListener, computed, input, model, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';

/**
 * 手続きの画面の骨組み（docs/ui-unification-design.md の1章）。どの手続きも上から
 * 見出し（app-page-head）→ 横並びのステップ（app-stepper）→ 本体（app-step-lead で始める）→ 下に固定の操作バー（app-action-bar）の順に並べる。
 * 1人の手続きは app-wizard、多人数の手続きは app-target-list がこれらを組み合わせる。
 */

/** 見出し：種類のタグ・件名・期限や対象人数（[meta] で渡す）。右に補助のボタン（[actions] で渡す） */
@Component({
  selector: 'app-page-head',
  standalone: true,
  imports: [RouterLink, MatIconModule],
  template: `
    <header class="page-head">
      <div class="head-main">
        @if (backLink() || kicker()) {
          <div class="kicker">
            @if (backLink(); as link) { <a [routerLink]="link" [queryParams]="backQuery()" class="back"><mat-icon aria-hidden="true">arrow_back</mat-icon>{{ backLabel() }}</a> }
            @if (kicker()) { <span class="tag">{{ kicker() }}</span> }
          </div>
        }
        <h1>{{ heading() }}<ng-content select="[headingExtra]" /></h1>
        <div class="meta"><ng-content select="[meta]" /></div>
      </div>
      <div class="head-actions"><ng-content select="[actions]" /></div>
    </header>
  `,
  styles: [`
    .page-head { display: flex; align-items: flex-start; gap: var(--app-space-4); margin-bottom: var(--app-space-4); flex-wrap: wrap; }
    .head-main { min-width: 0; flex: 1; }
    h1 { margin: 0; font-size: 22px; font-weight: 600; }
    .kicker { display: flex; align-items: center; gap: var(--app-space-2); margin-bottom: 2px; font-size: var(--app-font-xs); color: var(--app-color-text-sub); }
    .tag { padding: 1px 7px; border-radius: 4px; background: var(--app-status-waiting-bg); color: var(--app-color-text-sub); font-weight: 600; }
    .back { display: inline-flex; align-items: center; gap: 2px; color: var(--app-color-link); text-decoration: none; }
    .back:hover { text-decoration: underline; }
    .back mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .meta { display: flex; gap: var(--app-space-2) var(--app-space-4); flex-wrap: wrap; margin-top: 2px; font-size: var(--app-font-sm); color: var(--app-color-text-sub); }
    .meta:empty { display: none; }
    :host ::ng-deep .meta b { color: var(--app-color-text); font-weight: 600; }
    :host ::ng-deep .meta .due-soon { color: var(--app-status-attention-fg); font-weight: 700; }
    :host ::ng-deep .meta .due-over { color: var(--app-status-error-fg); font-weight: 700; }
    .head-actions { display: flex; gap: var(--app-space-2); align-items: center; flex-wrap: wrap; }
    .head-actions:empty { display: none; }
  `],
})
export class PageHeadComponent {
  heading = input.required<string>();
  /** 種類のタグ（例：「まとめて」「入社」） */
  kicker = input<string>();
  /** 一覧などへ戻るリンク */
  backLink = input<string | unknown[]>();
  backQuery = input<Record<string, string> | null>(null);
  backLabel = input('戻る');
}

/**
 * ステップの状態。current（表示中）は stepper の current で決まるので、ここには入れない。
 * attention＝要確認がある、waiting＝ほかの人を待っている、todo＝未着手・作業中
 */
export type StepperState = 'done' | 'attention' | 'waiting' | 'todo';

export interface StepperItem {
  key: string;
  label: string;
  state: StepperState;
  /** ラベルの下の1行（数字は1つだけ：「要確認1名」→「残り3名」→「完了」→「—」） */
  note?: string;
  /** 押せないステップ（1人の手続きで、まだ進んでいない先のステップなど） */
  disabled?: boolean;
}

/** 横並びのステップ。1本だけ。押すとそのステップの本体に切り替わる */
@Component({
  selector: 'app-stepper',
  standalone: true,
  imports: [MatIconModule],
  template: `
    <nav class="stepper" [attr.aria-label]="label()">
      @for (s of steps(); track s.key; let i = $index) {
        <button type="button" [attr.data-state]="s.state" [class.cur]="s.key === current()"
                [attr.aria-current]="s.key === current() ? 'step' : null" [disabled]="s.disabled && s.key !== current()"
                (click)="s.key !== current() && select.emit(s.key)">
          <span class="dot" aria-hidden="true">
            @switch (s.state) {
              @case ('done') { <mat-icon>check</mat-icon> }
              @case ('waiting') { <mat-icon>hourglass_empty</mat-icon> }
              @default { {{ i + 1 }} }
            }
          </span>
          <span class="t">
            <b>{{ s.label }}</b>
            <span class="note">{{ s.note ?? stateLabels[s.state] }}</span>
          </span>
        </button>
      }
    </nav>
  `,
  styles: [`
    .stepper {
      display: flex; align-items: stretch; margin-bottom: var(--app-space-4); overflow-x: auto;
      background: var(--app-color-surface); border: 1px solid var(--app-color-border); border-radius: var(--app-radius);
    }
    button {
      flex: 1 1 0; display: flex; align-items: center; gap: 8px; min-width: 104px; padding: 10px 12px; position: relative;
      border: 0; background: none; font: inherit; text-align: left; color: var(--app-color-text); cursor: pointer;
    }
    button + button { border-left: 1px solid var(--app-color-border); }
    button:hover:not(:disabled) { background: var(--app-color-surface-sub); }
    button:disabled { cursor: default; color: var(--app-color-text-sub); }
    button:focus-visible { outline: 2px solid var(--app-color-link); outline-offset: -2px; }
    .dot {
      flex: none; display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%;
      font-size: var(--app-font-xs); font-weight: 700; background: var(--app-status-waiting-bg); color: var(--app-color-text-sub);
    }
    .dot mat-icon { font-size: 16px; width: 16px; height: 16px; }
    [data-state='done'] .dot { background: var(--app-status-done-bg); color: var(--app-status-done-fg); }
    [data-state='attention'] .note { color: var(--app-status-attention-fg); font-weight: 600; }
    .cur { background: var(--app-status-yours-bg); }
    .cur::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 2px; background: var(--app-status-yours-fg); }
    .cur .dot { background: var(--app-status-yours-fg); color: #fff; }
    .cur b { color: var(--app-status-yours-fg); }
    .t { min-width: 0; }
    .t b { display: block; font-size: var(--app-font-sm); font-weight: 600; line-height: 1.35; }
    .note { display: block; font-size: 11px; line-height: 1.35; color: var(--app-color-text-sub); }
  `],
})
export class StepperComponent {
  steps = input.required<StepperItem[]>();
  current = input.required<string>();
  label = input('ステップ');
  select = output<string>();
  readonly stateLabels: Record<StepperState, string> = { done: '完了', attention: '要確認', waiting: '待ち', todo: '—' };
}

/** 本体の見出しと「やること」の1行。右に小さな補助（[right] で渡す） */
@Component({
  selector: 'app-step-lead',
  standalone: true,
  template: `
    <div class="lead">
      <h2 [id]="headingId()">{{ heading() }}</h2>
      @if (text()) { <p>{{ text() }}</p> }
      <div class="right"><ng-content select="[right]" /></div>
    </div>
  `,
  styles: [`
    .lead { display: flex; align-items: baseline; gap: var(--app-space-3); flex-wrap: wrap; padding-bottom: var(--app-space-3); margin-bottom: var(--app-space-4); border-bottom: 1px solid var(--app-color-border); }
    h2 { margin: 0; font-size: var(--app-font-lg); font-weight: 600; white-space: nowrap; }
    p { margin: 0; flex: 1; min-width: 200px; font-size: var(--app-font-sm); color: var(--app-color-text-sub); line-height: 1.6; }
    .right { margin-left: auto; display: flex; gap: var(--app-space-2); align-items: center; }
    .right:empty { display: none; }
  `],
})
export class StepLeadComponent {
  heading = input.required<string>();
  text = input<string>();
  headingId = input<string>();
}

/**
 * 下に固定の操作バー。左に選択中の人数や保存の状態（info）、右に注意の1行（notice）と主ボタン（中に書く。主ボタンは右端に1つ）。
 * 注意は、取り返しのつかない操作・期限・法律上の迷いやすい所のときだけ出す
 */
@Component({
  selector: 'app-action-bar',
  standalone: true,
  imports: [MatIconModule],
  template: `
    <div class="actionbar" role="region" aria-label="操作">
      <div class="info"><ng-content select="[info]" />{{ info() }}</div>
      <div class="right">
        @if (notice()) { <span class="notice" [attr.data-tone]="noticeTone()"><mat-icon aria-hidden="true">{{ noticeTone() === 'error' ? 'error' : 'info' }}</mat-icon>{{ notice() }}</span> }
        <ng-content />
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; position: sticky; bottom: -24px; z-index: 5; margin: var(--app-space-5) -24px -24px; }
    .actionbar {
      display: flex; align-items: center; gap: var(--app-space-3); flex-wrap: wrap; padding: var(--app-space-3) var(--app-space-5);
      background: var(--app-color-surface); border-top: 1px solid var(--app-color-border); box-shadow: 0 -4px 16px rgba(16, 24, 40, .06);
    }
    .info { font-size: var(--app-font-sm); color: var(--app-color-text-sub); }
    :host ::ng-deep .info b { color: var(--app-color-text); }
    .right { margin-left: auto; display: flex; gap: var(--app-space-2); align-items: center; flex-wrap: wrap; justify-content: flex-end; }
    .notice { display: inline-flex; align-items: center; gap: 4px; max-width: 520px; font-size: var(--app-font-xs); line-height: 1.5; color: var(--app-status-attention-fg); }
    .notice[data-tone='error'] { color: var(--app-status-error-fg); }
    .notice[data-tone='info'] { color: var(--app-color-text-sub); }
    .notice mat-icon { flex: none; font-size: 16px; width: 16px; height: 16px; }
  `],
})
export class ActionBarComponent {
  info = input<string>('');
  notice = input<string | null | undefined>();
  noticeTone = input<'attention' | 'error' | 'info'>('attention');
}

/**
 * 右から重なって開くパネル（1人分の内訳）。表の幅と絞り込みはそのまま。
 * 「‹ 前」「次 ›」と「2 / 8人目」、Esc で閉じる。中身は中に書き、下のボタンは [panelFoot] で渡す
 */
@Component({
  selector: 'app-side-panel',
  standalone: true,
  imports: [MatIconModule],
  template: `
    @if (open()) {
      <div class="scrim" (click)="close()" aria-hidden="true"></div>
      <aside class="panel" role="dialog" aria-modal="false" [attr.aria-label]="heading()">
        <div class="head">
          <div class="who">
            @if (kicker()) { <div class="kicker">{{ kicker() }}</div> }
            <h2>{{ heading() }}</h2>
          </div>
          @if (total() > 1) {
            <div class="nav">
              <button type="button" (click)="prev.emit()" [disabled]="position() <= 1" aria-label="前の人">‹ 前</button>
              <span>{{ position() }} / {{ total() }}{{ unit() }}</span>
              <button type="button" (click)="next.emit()" [disabled]="position() >= total()" aria-label="次の人">次 ›</button>
            </div>
          }
          <button type="button" class="x" (click)="close()" aria-label="閉じる"><mat-icon>close</mat-icon></button>
        </div>
        <div class="body"><ng-content /></div>
        <div class="foot"><ng-content select="[panelFoot]" /></div>
      </aside>
    }
  `,
  styles: [`
    .scrim { position: fixed; inset: 0; z-index: 900; background: rgba(17, 24, 39, .25); }
    .panel {
      position: fixed; top: 0; right: 0; bottom: 0; z-index: 901; width: 480px; max-width: 100%;
      display: flex; flex-direction: column; background: var(--app-color-surface); box-shadow: -8px 0 32px rgba(16, 24, 40, .15);
    }
    .head { display: flex; align-items: flex-start; gap: var(--app-space-3); padding: var(--app-space-4) var(--app-space-5); border-bottom: 1px solid var(--app-color-border); }
    .who { flex: 1; min-width: 0; }
    .kicker { font-size: var(--app-font-xs); color: var(--app-color-text-sub); }
    h2 { margin: 0; font-size: 17px; font-weight: 600; }
    .nav { display: flex; align-items: center; gap: var(--app-space-2); font-size: var(--app-font-xs); color: var(--app-color-text-sub); white-space: nowrap; }
    .nav button { padding: 2px 8px; border: 1px solid var(--app-color-border); border-radius: 6px; background: var(--app-color-surface); font: inherit; cursor: pointer; }
    .nav button:disabled { opacity: .4; cursor: default; }
    .x { border: 0; background: none; cursor: pointer; color: var(--app-color-text-sub); padding: 0; }
    .body { flex: 1; overflow: auto; padding: var(--app-space-4) var(--app-space-5); }
    .foot { display: flex; gap: var(--app-space-2); justify-content: flex-end; flex-wrap: wrap; padding: var(--app-space-3) var(--app-space-5); border-top: 1px solid var(--app-color-border); }
    .foot:empty { display: none; }
  `],
})
export class SidePanelComponent {
  open = model(false);
  heading = input('');
  kicker = input<string>();
  /** 何人目か（1始まり）と全体の人数。2人以上のときだけ前後のボタンを出す */
  position = input(0);
  total = input(0);
  unit = input('人目');
  prev = output<void>();
  next = output<void>();
  closed = output<void>();

  hasNav = computed(() => this.total() > 1);

  close() {
    this.open.set(false);
    this.closed.emit();
  }

  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent) {
    if (!this.open()) return;
    // 入力欄の中の矢印キーは邪魔しない
    const typing = e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]');
    if (e.key === 'Escape') this.close();
    else if (!typing && e.key === 'ArrowLeft' && this.position() > 1) this.prev.emit();
    else if (!typing && e.key === 'ArrowRight' && this.position() < this.total()) this.next.emit();
  }
}
