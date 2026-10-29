import { Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

/** 読み込み中の表示 */
@Component({
  selector: 'app-loading-state',
  standalone: true,
  imports: [MatProgressSpinnerModule],
  template: `
    <div class="state" role="status" aria-live="polite">
      <mat-spinner diameter="32"></mat-spinner>
      <p>{{ message() }}</p>
    </div>
  `,
  styleUrl: './page-state.scss',
})
export class LoadingStateComponent {
  message = input('読み込んでいます…');
}

/** データがないときの表示。次にやることがあれば hint で伝える */
@Component({
  selector: 'app-empty-state',
  standalone: true,
  imports: [MatIconModule],
  template: `
    <div class="state">
      <mat-icon aria-hidden="true" class="state-icon">{{ icon() }}</mat-icon>
      <p class="state-title">{{ message() }}</p>
      @if (hint()) { <p class="state-hint">{{ hint() }}</p> }
      <ng-content />
    </div>
  `,
  styleUrl: './page-state.scss',
})
export class EmptyStateComponent {
  message = input.required<string>();
  hint = input<string>();
  icon = input('inbox');
}

/** エラーの表示。retry を受け取る画面では「もう一度試す」を出す */
@Component({
  selector: 'app-error-state',
  standalone: true,
  imports: [MatButtonModule, MatIconModule],
  template: `
    <div class="state error" role="alert">
      <mat-icon aria-hidden="true" class="state-icon">error_outline</mat-icon>
      <p class="state-title">{{ heading() }}</p>
      @if (message()) { <p class="state-hint">{{ message() }}</p> }
      @if (retryable()) {
        <button mat-stroked-button type="button" (click)="retry.emit()">
          <mat-icon>refresh</mat-icon> もう一度試す
        </button>
      }
    </div>
  `,
  styleUrl: './page-state.scss',
})
export class ErrorStateComponent {
  heading = input('読み込めませんでした');
  message = input<string>();
  retryable = input(true);
  retry = output<void>();
}
