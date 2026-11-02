import { Component, ElementRef, OnChanges, inject, input, signal, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import { ConfirmDialogComponent } from '../../../shared/confirm-dialog/confirm-dialog';
import { errorMessage } from '../../onboarding/onboarding.types';
import type { FilingTarget } from '../submission/filing-submission';

interface ChecklistItem { key: string; label: string; need: 'required' | 'conditional'; note: string | null }
interface AttachmentItem { id: string; name: string; contentType: string; size: number; checklistKey: string | null; uploadedAt: string | null; uploadedByName: string }
interface AttachmentList { checklist: ChecklistItem[]; items: AttachmentItem[]; locked: boolean; missing: string[] }

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = 'application/pdf,image/jpeg,image/png';

/**
 * 届出の添付書類。種類ごとの必要書類のチェックリストと、PDF・画像の添付（1ファイル5MBまで）。
 * ファイルは関数を通して保存し、画面から Storage を直接触らない
 */
@Component({
  selector: 'app-filing-attachments',
  standalone: true,
  imports: [DatePipe, MatButtonModule, MatIconModule],
  template: `
    @if (list(); as l) {
      @if (l.checklist.length) {
        <ul class="checklist" aria-label="必要書類">
          @for (c of l.checklist; track c.key) {
            <li [class.missing]="l.missing.includes(c.key)">
              <div class="head">
                <mat-icon aria-hidden="true">{{ filesOf(c.key).length ? 'check_circle' : c.need === 'required' ? 'error_outline' : 'radio_button_unchecked' }}</mat-icon>
                <span class="label">{{ c.label }}</span>
                <span class="need" [attr.data-need]="c.need">{{ c.need === 'required' ? '原則必要' : '場合により必要' }}</span>
              </div>
              @if (c.note) { <p class="note">{{ c.note }}</p> }
              @for (f of filesOf(c.key); track f.id) {
                <div class="file">{{ f.name }} <span class="muted">{{ size(f.size) }}・{{ f.uploadedByName }} {{ f.uploadedAt | date:'M/d H:mm' }}</span>
                  <button mat-button type="button" (click)="open(f)" [disabled]="busy()">開く</button>
                  @if (!l.locked && isStaff) { <button mat-button type="button" (click)="remove(f)" [disabled]="busy()">削除</button> }
                </div>
              }
              @if (!l.locked && isStaff) {
                <button mat-stroked-button type="button" (click)="pick(c.key)" [disabled]="busy()"><mat-icon>attach_file</mat-icon>この書類を添付する</button>
              }
            </li>
          }
        </ul>
      } @else {
        <p class="muted">この届出は、原則として添付書類はいりません。@if (isStaff) {年金事務所から求められたときは、下の「ほかの書類を添付する」で添付します。}</p>
      }

      @if (filesOf(null).length) {
        <h3>ほかの添付</h3>
        @for (f of filesOf(null); track f.id) {
          <div class="file">{{ f.name }} <span class="muted">{{ size(f.size) }}・{{ f.uploadedByName }} {{ f.uploadedAt | date:'M/d H:mm' }}</span>
            <button mat-button type="button" (click)="open(f)" [disabled]="busy()">開く</button>
            @if (!l.locked && isStaff) { <button mat-button type="button" (click)="remove(f)" [disabled]="busy()">削除</button> }
          </div>
        }
      }
      @if (l.locked) {
        <p class="muted">提出を始めたので、添付の追加・削除はできません。</p>
      } @else if (isStaff) {
        <button mat-button type="button" (click)="pick(null)" [disabled]="busy()"><mat-icon>add</mat-icon>ほかの書類を添付する</button>
        <p class="muted small">PDF・JPEG・PNG、1ファイル5MBまで、1件の届出に20ファイルまで。</p>
      }
      <input #fileInput type="file" [accept]="accept" hidden (change)="chosen(fileInput)">
    } @else if (error()) {
      <p class="alert" role="alert">{{ error() }} <button mat-button type="button" (click)="load()">読み込み直す</button></p>
    } @else {
      <p class="muted" role="status">添付書類を読み込んでいます…</p>
    }
  `,
  styles: [`
    :host { display: block; }
    .checklist { list-style: none; margin: 0 0 12px; padding: 0; display: flex; flex-direction: column; gap: 10px; }
    .checklist li { padding: 10px 12px; border: 1px solid var(--app-color-border); border-radius: 8px; }
    .checklist li.missing { border-color: var(--app-status-action-fg); }
    .head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .head mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--app-color-text-sub); }
    li.missing .head mat-icon { color: var(--app-status-action-fg); }
    .need { font-size: 12px; padding: 0 8px; border-radius: 10px; background: var(--app-status-waiting-bg); color: var(--app-status-waiting-fg); }
    .need[data-need="required"] { background: var(--app-status-action-bg); color: var(--app-status-action-fg); }
    .note { margin: 4px 0 6px 26px; font-size: 13px; color: var(--app-color-text-sub); }
    .file { margin: 4px 0 4px 26px; font-size: 14px; word-break: break-all; }
    h3 { font-size: 14px; margin: 12px 0 4px; }
    .muted { color: var(--app-color-text-sub); }
    .small { font-size: 12px; margin-top: 0; }
    .alert { padding: 8px 12px; border-radius: 8px; background: var(--app-status-action-bg); }
  `],
})
export class FilingAttachmentsComponent implements OnChanges {
  private functions = inject(Functions);
  private auth = inject(AuthService);
  /** 添付・削除は担当者だけ（承認者は開いて確かめるだけ） */
  readonly isStaff = inject(AuthService).hasAnyRole('admin', 'operator');
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);

  target = input.required<FilingTarget>();
  list = signal<AttachmentList | null>(null);
  error = signal('');
  busy = signal(false);
  accept = ACCEPT;
  private pendingKey: string | null = null;
  private fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  ngOnChanges() { void this.load(); }

  filesOf(key: string | null) { return (this.list()?.items ?? []).filter(i => (i.checklistKey ?? null) === key); }
  size(n: number) { return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.ceil(n / 1024)}KB`; }

  async load() {
    try {
      const { data } = await httpsCallable<object, AttachmentList>(this.functions, 'filingAttachmentList')({ companyId: this.auth.companyId, ...this.target() });
      this.list.set(data);
      this.error.set('');
    } catch (e) {
      this.error.set(errorMessage(e, '添付書類を読み込めませんでした'));
    }
  }

  pick(key: string | null) {
    this.pendingKey = key;
    const el = this.fileInput()?.nativeElement;
    if (el) { el.value = ''; el.click(); }
  }

  async chosen(el: HTMLInputElement) {
    const file = el.files?.[0];
    if (!file) return;
    if (file.size > MAX_BYTES) { this.snackBar.open('1ファイル5MBまでです', '閉じる', { duration: 5000 }); return; }
    if (!ACCEPT.split(',').includes(file.type)) { this.snackBar.open('PDF・JPEG・PNGのファイルだけ添付できます', '閉じる', { duration: 5000 }); return; }
    this.busy.set(true);
    try {
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
        reader.onerror = () => reject(new Error('ファイルを読み込めませんでした'));
        reader.readAsDataURL(file);
      });
      await httpsCallable(this.functions, 'filingAttachmentUpload', { timeout: 120_000 })({
        companyId: this.auth.companyId, ...this.target(), name: file.name, dataBase64, checklistKey: this.pendingKey,
      });
      this.snackBar.open(`${file.name} を添付しました`, '閉じる', { duration: 4000 });
      await this.load();
    } catch (e) {
      this.snackBar.open(errorMessage(e, '添付できませんでした'), '閉じる', { duration: 8000 });
    } finally {
      this.busy.set(false);
    }
  }

  async open(f: AttachmentItem) {
    this.busy.set(true);
    try {
      const { data } = await httpsCallable<object, { name: string; contentType: string; dataBase64: string }>(this.functions, 'filingAttachmentGet')({
        companyId: this.auth.companyId, ...this.target(), attachmentId: f.id,
      });
      const bytes = Uint8Array.from(atob(data.dataBase64), c => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: data.contentType }));
      const a = document.createElement('a');
      a.href = url; a.download = data.name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (e) {
      this.snackBar.open(errorMessage(e, '開けませんでした'), '閉じる', { duration: 6000 });
    } finally {
      this.busy.set(false);
    }
  }

  async remove(f: AttachmentItem) {
    const ok = await firstValueFrom(this.dialog.open(ConfirmDialogComponent, {
      data: { title: '添付を削除する', message: `${f.name} を削除します。削除したファイルは元に戻せません。`, confirmLabel: '削除する', warn: true },
    }).afterClosed());
    if (!ok) return;
    this.busy.set(true);
    try {
      await httpsCallable(this.functions, 'filingAttachmentDelete')({ companyId: this.auth.companyId, ...this.target(), attachmentId: f.id });
      await this.load();
    } catch (e) {
      this.snackBar.open(errorMessage(e, '削除できませんでした'), '閉じる', { duration: 6000 });
    } finally {
      this.busy.set(false);
    }
  }
}
