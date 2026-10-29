import { Component, computed, input, model, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

/**
 * ウィザードの1ステップ。label は動詞で書く（例：「資格取得届を作る」）。
 * what・why・next は1文ずつ、初心者が説明書なしで読める言葉にする。
 */
export interface WizardStep {
  key: string;
  label: string;
  /** やること */
  what: string;
  /** なぜ必要か */
  why: string;
  /** 次に何が起きるか */
  next: string;
  /** 完了したステップ。省略時は現在より前のステップを完了とみなす */
  done?: boolean;
  /** 他の人の操作を待っているステップ（承認など）。待っている相手を書く */
  waitingFor?: string;
}

type StepView = WizardStep & { index: number; view: 'done' | 'current' | 'waiting' | 'todo' };

/**
 * 個人型の手続きの枠。進捗・ステップ一覧・各ステップの説明・戻る／次へを表示し、
 * 現在のステップの入力フォームは <app-wizard> の中に書く。
 * 「次へ」は advance を出すだけなので、保存などが終わってから呼び出し側で current を進める。
 */
@Component({
  selector: 'app-wizard',
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatIconModule, MatProgressBarModule, MatProgressSpinnerModule],
  template: `
    <div class="wizard">
      <header class="wizard-header">
        <div>
          <h1 class="wizard-title">{{ heading() }}</h1>
          @if (subtitle()) { <div class="wizard-subtitle">{{ subtitle() }}</div> }
        </div>
        <div class="wizard-progress">
          <span>{{ doneCount() }} / {{ steps().length }} ステップ完了</span>
          <mat-progress-bar mode="determinate" [value]="percent()" aria-label="進み具合"></mat-progress-bar>
        </div>
      </header>

      <div class="wizard-body">
        <nav class="step-list" aria-label="ステップ一覧">
          <ol>
            @for (s of views(); track s.key) {
              <li [attr.data-view]="s.view" [attr.aria-current]="s.index === current() ? 'step' : null">
                <button type="button" class="step-button" [disabled]="!canJump(s)" (click)="current.set(s.index)">
                  <span class="step-mark" aria-hidden="true">
                    @switch (s.view) {
                      @case ('done') { <mat-icon>check</mat-icon> }
                      @case ('waiting') { <mat-icon>hourglass_empty</mat-icon> }
                      @default { {{ s.index + 1 }} }
                    }
                  </span>
                  <span class="step-label">{{ s.label }}<span class="visually-hidden">（{{ viewLabels[s.view] }}）</span></span>
                </button>
              </li>
            }
          </ol>
        </nav>

        <section class="step-panel" [attr.aria-labelledby]="'wizard-step-' + step().key">
          <h2 class="step-title" [id]="'wizard-step-' + step().key">
            <span class="step-number">ステップ {{ current() + 1 }}</span>{{ step().label }}
          </h2>
          <dl class="step-guide">
            <div><dt>やること</dt><dd>{{ step().what }}</dd></div>
            <div><dt>なぜ必要か</dt><dd>{{ step().why }}</dd></div>
            <div><dt>次に起きること</dt><dd>{{ step().next }}</dd></div>
          </dl>

          @if (step().waitingFor) {
            <div class="waiting" role="status">
              <mat-icon aria-hidden="true">hourglass_empty</mat-icon>
              <div>
                <strong>{{ step().waitingFor }}の操作を待っています。</strong>
                ここで待つ必要はありません。終わるとホームの「やること」に表示されるので、そこから続きを進めてください。
              </div>
            </div>
          }

          <div class="step-content"><ng-content /></div>

          <footer class="step-nav">
            <button mat-stroked-button type="button" (click)="back()" [disabled]="current() === 0 || busy()">
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
          </footer>
        </section>
      </div>
    </div>
  `,
  styleUrl: './wizard.scss',
})
export class WizardComponent {
  heading = input.required<string>();
  /** 対象者や期限など（例：「山田 太郎・提出期限 11月5日」） */
  subtitle = input<string>();
  steps = input.required<WizardStep[]>();
  /** 表示中のステップ番号（0始まり） */
  current = model(0);
  /** 「次へ」の文字。省略時は「次へ」（最後のステップは「完了する」） */
  nextLabel = input<string>();
  nextDisabled = input(false);
  /** 保存中など。ボタンを押せなくして読み込み中を表示する */
  busy = input(false);
  /** ステップの中に独自のボタンがある場合など、「次へ」を出さない */
  hideNext = input(false);
  advance = output<WizardStep>();

  readonly viewLabels = { done: '完了', current: '進行中', waiting: '待ち', todo: '未着手' };

  step = computed(() => this.steps()[this.current()]);
  isLast = computed(() => this.current() === this.steps().length - 1);
  views = computed<StepView[]>(() => this.steps().map((s, index) => ({
    ...s, index,
    view: this.isDone(s, index) ? 'done' : index === this.current() ? (s.waitingFor ? 'waiting' : 'current') : 'todo',
  })));
  doneCount = computed(() => this.views().filter(v => v.view === 'done').length);
  percent = computed(() => this.steps().length ? (this.doneCount() / this.steps().length) * 100 : 0);

  back() {
    if (this.current() > 0) this.current.set(this.current() - 1);
  }

  /** 完了したステップにだけ戻れる（先のステップへは飛ばせない） */
  canJump(s: StepView) {
    return !this.busy() && s.index !== this.current() && s.view === 'done';
  }

  private isDone(s: WizardStep, index: number) {
    return s.done ?? index < this.current();
  }
}
