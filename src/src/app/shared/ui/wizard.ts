import { Component, computed, input, model, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ActionBarComponent, PageHeadComponent, StepLeadComponent, StepperComponent, StepperItem } from './procedure-frame';
import { ProcedureCancelComponent } from './procedure-cancel';

/**
 * ウィザードの1ステップ。label は動詞で書く（例：「資格取得届を作る」）。
 * 画面に出すのは what（やることの1行）だけ。why は注意（caution）の文言の材料にする
 */
export interface WizardStep {
  key: string;
  label: string;
  /** やること（本体の見出しの横に1行で出す） */
  what: string;
  /** なぜ必要か（画面には出さない。注意の文言を書くときの材料） */
  why?: string;
  /** 次に何が起きるか（画面には出さない。主ボタンの文言で伝える） */
  next?: string;
  /** 主ボタンを押す前に知っておくべき注意（取り返しのつかない操作・期限・迷いやすい決まり）。操作バーに1行で出す */
  caution?: string;
  /** 完了したステップ。省略時は現在より前のステップを完了とみなす */
  done?: boolean;
  /** 他の人の操作を待っているステップ（承認など）。待っている相手を書く */
  waitingFor?: string;
  /** 要確認（差し戻し・返戻など）があるステップ */
  attention?: boolean;
  /** ステップの下の1行（例：「10/27 完了」）。省略時は状態の名前 */
  note?: string;
}

/**
 * 1人の手続きの枠（docs/ui-unification-design.md の1章）。見出し→横並びのステップ→本体→下に固定の操作バー。
 * 現在のステップの入力フォームは <app-wizard> の中に書く。見出しの補足は [meta]、右上の補助のボタンは [headActions] で渡す。
 * 主ボタンは advance を出すだけなので、保存などが終わってから呼び出し側で current を進める。
 */
@Component({
  selector: 'app-wizard',
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatIconModule, MatProgressSpinnerModule, PageHeadComponent, StepperComponent, StepLeadComponent, ActionBarComponent, ProcedureCancelComponent],
  template: `
    <app-page-head [heading]="displayHeading()" [kicker]="kicker()" [backLink]="backLink()" [backQuery]="backQuery()" [backLabel]="backLabel()">
      <ng-container ngProjectAs="[meta]">
        @if (subtitle()) { <span>{{ subtitle() }}</span> }
        <ng-content select="[meta]" />
      </ng-container>
      <ng-container ngProjectAs="[actions]"><ng-content select="[headActions]" /><app-procedure-cancel [procedureId]="procedureId()" [stateKey]="stateKey()" /></ng-container>
    </app-page-head>

    <app-stepper [steps]="items()" [current]="step().key" [label]="displayHeading() + 'のステップ'" (select)="jump($event)" />

    <section class="step-panel" [attr.aria-labelledby]="'wizard-step-' + step().key">
      <app-step-lead [heading]="step().label" [text]="step().what" [headingId]="'wizard-step-' + step().key" />

      @if (step().waitingFor) {
        <div class="waiting" role="status">
          <mat-icon aria-hidden="true">hourglass_empty</mat-icon>
          <div><strong>{{ step().waitingFor }}の操作を待っています。</strong>ここで待つ必要はありません。終わるとホームの「やること」に出ます。</div>
        </div>
      }

      <div class="step-content"><ng-content /></div>

      <app-action-bar [info]="info()" [notice]="notice() ?? step().caution">
        <button mat-button type="button" (click)="back()" [disabled]="current() === 0 || busy()">
          <mat-icon>arrow_back</mat-icon> 戻る
        </button>
        @if (step().waitingFor) {
          <a mat-flat-button routerLink="/home">ホームへ戻る</a>
        } @else if (!hideNext()) {
          <button mat-flat-button type="button" (click)="advance.emit(step())" [disabled]="nextDisabled() || busy()">
            @if (busy()) { <mat-spinner diameter="18"></mat-spinner> }
            {{ nextLabel() ?? (isLast() ? '完了する' : '次へ') }}
            @if (!busy() && !isLast()) { <mat-icon iconPositionEnd>arrow_forward</mat-icon> }
          </button>
        }
      </app-action-bar>
    </section>

  `,
  styleUrl: './wizard.scss',
})
export class WizardComponent {
  heading = input.required<string>();
  /** 対象の人の名前。渡すと、件名「山田 太郎 退職手続き」を「山田 太郎 の退職」の形にそろえる */
  personName = input<string>();
  /** 対象者や期限など（例：「山田 太郎・提出期限 11月5日」）。見出しの下に出す */
  subtitle = input<string>();
  /** 種類のタグ（例：「入社」） */
  kicker = input<string>();
  /** 手続きの ID。渡すと見出しの右に「この手続きをやめる」を出す（ロールと始めた人で出し分ける） */
  procedureId = input<string | null>(null);
  backLink = input<string | unknown[]>();
  backQuery = input<Record<string, string> | null>(null);
  backLabel = input('戻る');
  steps = input.required<WizardStep[]>();
  /** ステップの進み具合が変わったら「この手続きをやめる」を読み直す（完了したら消える） */
  stateKey = computed(() => this.steps().map(s => `${s.key}:${s.done ? 1 : 0}${s.waitingFor ? 'w' : ''}`).join('|'));
  /** 表示中のステップ番号（0始まり） */
  current = model(0);
  /** 主ボタンの文字。次に起こることが分かる文言にする（例：「台帳に登録して雇用条件へ」）。省略時は「次へ」（最後は「完了する」） */
  nextLabel = input<string>();
  nextDisabled = input(false);
  /** 保存中など。ボタンを押せなくして読み込み中を表示する */
  busy = input(false);
  /** ステップの中に独自のボタンがある場合など、主ボタンを出さない */
  hideNext = input(false);
  /** 操作バーの左（保存の状態など。例：「保存済み 10:42」） */
  info = input('');
  /** 操作バーの注意。省略時はステップの caution */
  notice = input<string | null>();
  advance = output<WizardStep>();

  displayHeading = computed(() => {
    const [heading, name] = [this.heading(), this.personName()];
    if (!name || !heading.startsWith(`${name} `)) return heading;
    return `${name} の${heading.slice(name.length + 1).replace(/の?手続き$/, '')}`;
  });
  step = computed(() => this.steps()[this.current()]);
  isLast = computed(() => this.current() === this.steps().length - 1);
  items = computed<StepperItem[]>(() => this.steps().map((s, index) => {
    const done = s.done ?? index < this.current();
    const state = done ? 'done' : s.attention ? 'attention' : s.waitingFor ? 'waiting' : 'todo';
    return {
      key: s.key, label: s.label, state,
      note: s.note ?? (index === this.current() && !done && !s.waitingFor && !s.attention ? 'あなたの番' : s.waitingFor ? `${s.waitingFor}待ち` : undefined),
      // 完了したステップにだけ戻れる（先のステップへは飛ばせない）
      disabled: this.busy() || !done,
    };
  }));

  back() {
    if (this.current() > 0) this.current.set(this.current() - 1);
  }

  jump(key: string) {
    const index = this.steps().findIndex(s => s.key === key);
    if (index >= 0) this.current.set(index);
  }
}
