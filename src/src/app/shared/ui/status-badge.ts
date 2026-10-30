import { Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

/**
 * 状態色5種（docs/ui-unification-design.md の5章）。画面に出す状態はすべてこのどれかに当てはめる。
 * yours＝あなたの番／attention＝要確認／waiting＝待ち（誰を待つかは文字で）／done＝完了／error＝エラー・期限切れ。
 * action は旧い「要対応」。作り直していない画面のために残しており、要確認と同じ見た目で出す
 */
export type StatusTone = 'yours' | 'attention' | 'waiting' | 'done' | 'error' | 'action';

export const STATUS_TONE_LABELS: Record<StatusTone, string> = {
  yours: 'あなたの番',
  attention: '要確認',
  waiting: '待ち',
  done: '完了',
  error: 'エラー',
  action: '要対応',
};

const TONE_ICONS: Record<StatusTone, string> = {
  yours: 'arrow_forward',
  attention: 'warning',
  waiting: 'hourglass_empty',
  done: 'check_circle',
  error: 'error',
  action: 'warning',
};

/** 自分が手を動かす必要がある状態（あなたの番・要確認・エラー） */
export function needsMe(tone: StatusTone) {
  return tone === 'yours' || tone === 'attention' || tone === 'error' || tone === 'action';
}

/** 状態の表示。色だけに頼らず、アイコンと文字でも区別できるようにする */
@Component({
  selector: 'app-status-badge',
  standalone: true,
  imports: [MatIconModule],
  template: `
    <span class="app-status" [attr.data-tone]="tone()">
      <mat-icon aria-hidden="true">{{ icon() }}</mat-icon>{{ label() ?? labels[tone()] }}
    </span>
  `,
  styles: [`
    mat-icon { font-size: 14px; width: 14px; height: 14px; }
  `],
})
export class StatusBadgeComponent {
  tone = input.required<StatusTone>();
  /** 省略時は状態色の名前（あなたの番など）を表示する */
  label = input<string>();
  labels = STATUS_TONE_LABELS;
  icon = () => TONE_ICONS[this.tone()];
}
