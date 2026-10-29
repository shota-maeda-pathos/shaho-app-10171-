import { Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

/** 状態色4種。画面に出す状態はすべてこのどれかに当てはめる */
export type StatusTone = 'action' | 'yours' | 'waiting' | 'done';

export const STATUS_TONE_LABELS: Record<StatusTone, string> = {
  action: '要対応',
  yours: 'あなたの番',
  waiting: '他の人の待ち',
  done: '完了',
};

const TONE_ICONS: Record<StatusTone, string> = {
  action: 'error',
  yours: 'arrow_forward',
  waiting: 'hourglass_empty',
  done: 'check_circle',
};

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
  /** 省略時は状態色の名前（要対応など）を表示する */
  label = input<string>();
  labels = STATUS_TONE_LABELS;
  icon = () => TONE_ICONS[this.tone()];
}
