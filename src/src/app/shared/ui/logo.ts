import { Component, input } from '@angular/core';

/**
 * Ordia のロゴ（3本線のマーク＋文字）。右端をそろえ、下ほど長い3本線を斜めにしたもの（ui-proposals/assets/shell.js の ordiaMark と同じ形）。
 * size はマークの幅（px）。wordmark を false にするとマークだけ。
 */
@Component({
  selector: 'app-logo',
  standalone: true,
  template: `
    <svg [attr.width]="size()" [attr.height]="size() * 0.8" viewBox="0 0 34 27" aria-hidden="true">
      <g fill="currentColor" transform="skewX(-22) translate(10 0)">
        <rect x="9" y="0" width="17" height="7" rx="3.2" />
        <rect x="4.5" y="10" width="21.5" height="7" rx="3.2" />
        <rect x="0" y="20" width="26" height="7" rx="3.2" />
      </g>
    </svg>
    @if (wordmark()) { <span class="word">Ordia</span> }
  `,
  styles: [`
    :host { display: inline-flex; align-items: center; gap: 8px; color: var(--app-brand-ink); }
    svg { display: block; color: var(--app-brand); flex: none; }
    .word { font-size: 21px; font-weight: 800; letter-spacing: -.01em; line-height: 1; }
  `],
})
export class LogoComponent {
  size = input(30);
  wordmark = input(true);
}
