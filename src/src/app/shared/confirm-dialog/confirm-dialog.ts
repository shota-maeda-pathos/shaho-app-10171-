import { Component, Injectable, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';

/**
 * 画面内の確認（docs/ui-unification-design.md の5章）。承認依頼・承認・提出・取り消しなど取り返しのつかない操作は、
 * 対象の人数・中身の要約・注意を1枚にまとめて確かめてから行う。window.confirm は使わない
 */
export interface ConfirmDialogData {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  warn?: boolean;
  /** 対象の人数や件数（例：「6名」）。見出しの下に大きく出す */
  count?: string;
  /** 中身の要約（対象者の名前・金額など）。多いときは先頭だけ出して残りの件数を書く */
  items?: string[];
  /** 押す前に知っておくべき注意（1行） */
  notice?: string;
}

const MAX_ITEMS = 8;

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content>
      @if (data.count) { <p class="count">対象：<strong>{{ data.count }}</strong></p> }
      <p class="message">{{ data.message }}</p>
      @if (data.items?.length) {
        <ul class="items">
          @for (item of shown; track $index) { <li>{{ item }}</li> }
          @if (rest > 0) { <li class="rest">ほか {{ rest }}件</li> }
        </ul>
      }
      @if (data.notice) {
        <p class="notice"><mat-icon aria-hidden="true">info</mat-icon>{{ data.notice }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">{{ data.cancelLabel ?? 'やめる' }}</button>
      <button mat-flat-button type="button" [color]="data.warn ? 'warn' : 'primary'" [mat-dialog-close]="true" cdkFocusInitial>
        {{ data.confirmLabel ?? '実行する' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .count { margin: 0 0 var(--app-space-2); font-size: var(--app-font-sm); color: var(--app-color-text-sub); }
    .count strong { font-size: var(--app-font-lg); color: var(--app-color-text); }
    .message { margin: 0; line-height: 1.7; white-space: pre-line; }
    .items { margin: var(--app-space-3) 0 0; padding: var(--app-space-2) var(--app-space-3) var(--app-space-2) var(--app-space-5);
      background: var(--app-color-surface-sub); border-radius: var(--app-radius); font-size: var(--app-font-sm); line-height: 1.7; }
    .rest { list-style: none; margin-left: calc(-1 * var(--app-space-3)); color: var(--app-color-text-sub); }
    .notice { display: flex; gap: var(--app-space-2); align-items: flex-start; margin: var(--app-space-3) 0 0; padding: var(--app-space-2) var(--app-space-3);
      border-radius: var(--app-radius); background: var(--app-status-attention-bg); color: var(--app-status-attention-fg); font-size: var(--app-font-sm); line-height: 1.6; }
    .notice mat-icon { flex: none; font-size: 18px; width: 18px; height: 18px; }
  `],
})
export class ConfirmDialogComponent {
  data = inject<ConfirmDialogData>(MAT_DIALOG_DATA);
  shown = (this.data.items ?? []).slice(0, MAX_ITEMS);
  rest = Math.max(0, (this.data.items?.length ?? 0) - MAX_ITEMS);
}

/** 確認ダイアログを開き、「実行する」が押されたら true を返す */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  private dialog = inject(MatDialog);

  async ask(data: ConfirmDialogData): Promise<boolean> {
    const ref = this.dialog.open(ConfirmDialogComponent, { data, width: '480px', maxWidth: '95vw' });
    return (await firstValueFrom(ref.afterClosed())) === true;
  }
}
