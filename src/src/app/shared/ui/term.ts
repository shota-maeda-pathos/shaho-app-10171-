import { Component, computed, input, signal } from '@angular/core';
import { OverlayModule } from '@angular/cdk/overlay';
import { MatIconModule } from '@angular/material/icon';
import { GLOSSARY, GlossaryKey } from './glossary';

let nextId = 0;

/** 用語と「?」ボタン。押すと用語集の説明を吹き出しで表示する */
@Component({
  selector: 'app-term',
  standalone: true,
  imports: [OverlayModule, MatIconModule],
  template: `
    @if (showLabel()) {<span>{{ entry().term }}</span>}<button
      type="button" class="help" cdkOverlayOrigin #origin="cdkOverlayOrigin"
      [attr.aria-label]="entry().term + 'とは'" [attr.aria-expanded]="open()" [attr.aria-controls]="panelId"
      (click)="open.set(!open())"><mat-icon aria-hidden="true">help_outline</mat-icon></button>
    <ng-template cdkConnectedOverlay [cdkConnectedOverlayOrigin]="origin" [cdkConnectedOverlayOpen]="open()"
                 [cdkConnectedOverlayHasBackdrop]="true" cdkConnectedOverlayBackdropClass="cdk-overlay-transparent-backdrop"
                 (backdropClick)="open.set(false)" (detach)="open.set(false)" (overlayKeydown)="onKeydown($event)">
      <div class="term-panel" role="dialog" [id]="panelId" [attr.aria-label]="entry().term">
        <div class="term-title">{{ entry().term }}</div>
        <p>{{ entry().body }}</p>
      </div>
    </ng-template>
  `,
  styles: [`
    :host { display: inline-flex; align-items: center; gap: 2px; }
    .help { display: inline-flex; padding: 0; border: 0; background: none; cursor: pointer; color: var(--app-color-link); border-radius: 50%; }
    .help:focus-visible { outline: 2px solid var(--app-color-link); }
    .help mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .term-panel { max-width: 360px; padding: var(--app-space-3) var(--app-space-4); background: var(--app-color-surface);
      border: 1px solid var(--app-color-border); border-radius: var(--app-radius); box-shadow: 0 4px 16px rgba(0,0,0,.15);
      font-size: var(--app-font-md); line-height: 1.7; color: var(--app-color-text); }
    .term-title { font-weight: 600; margin-bottom: var(--app-space-1); }
    .term-panel p { margin: 0; }
  `],
})
export class TermComponent {
  key = input.required<GlossaryKey>();
  /** false にすると「?」だけを表示する（用語を見出しなどに書いている場合） */
  showLabel = input(true);
  open = signal(false);
  entry = computed(() => GLOSSARY[this.key()]);
  readonly panelId = `app-term-${nextId++}`;

  onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') this.open.set(false);
  }
}
