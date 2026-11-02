import { Component, Injectable, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';

interface CancelDialogData { title: string; own: boolean; creatorName: string }

/** やめる前の確認。ほかの人が始めた手続き（管理者だけ）は理由を必須にする */
@Component({
  selector: 'app-procedure-cancel-dialog',
  standalone: true,
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  template: `
    <h2 mat-dialog-title>この手続きをやめる</h2>
    <mat-dialog-content>
      <p>「{{ data.title }}」をやめます。手続きは消さずに「取消」として残り、進行中の一覧とやることには出なくなります。作りかけの届出の下書きも一緒に取り下げます。</p>
      @if (!data.own) { <p class="warn">{{ data.creatorName }}さんが始めた手続きです。やめると、その事業所のスタッフにお知らせが出ます。</p> }
      <mat-form-field appearance="outline" class="reason">
        <mat-label>やめる理由{{ data.own ? '（任意）' : '' }}</mat-label>
        <input matInput [(ngModel)]="reason" maxlength="200" placeholder="例：対象の人を間違えた">
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>やめない</button>
      <button mat-flat-button color="warn" type="button" [disabled]="!data.own && !reason.trim()" (click)="ref.close(reason.trim())">手続きをやめる</button>
    </mat-dialog-actions>
  `,
  styles: [`.reason { width: 100%; } .warn { color: var(--app-status-action-fg); }`],
})
export class ProcedureCancelDialogComponent {
  data = inject<CancelDialogData>(MAT_DIALOG_DATA);
  ref = inject(MatDialogRef<ProcedureCancelDialogComponent, string>);
  reason = '';
}

@Injectable({ providedIn: 'root' })
export class ProcedureCancelDialogService {
  private dialog = inject(MatDialog);
  /** 理由（空文字もありうる）を返す。やめないときは null */
  async ask(data: CancelDialogData): Promise<string | null> {
    const ref = this.dialog.open(ProcedureCancelDialogComponent, { data, width: '480px', maxWidth: '95vw' });
    const r = await firstValueFrom(ref.afterClosed());
    return typeof r === 'string' ? r : null;
  }
}

interface ProcedureSummary { title: string; status: string; version: number; createdBy: string; createdByName?: string | null }

/**
 * 手続きの見出しの右に置く「この手続きをやめる」。担当者は自分が始めた手続きだけ、管理者はだれの手続きでも。
 * ほかの人が始めた手続きを担当者が開いたときは、ボタンの代わりにだれに頼むかを出す（サーバーでも同じ判定をする）
 */
@Component({
  selector: 'app-procedure-cancel',
  standalone: true,
  imports: [MatButtonModule, MatIconModule],
  template: `
    @if (state(); as s) {
      @if (s.can) {
        <button mat-stroked-button type="button" class="cancel" (click)="cancel()" [disabled]="busy()"><mat-icon>block</mat-icon>この手続きをやめる</button>
      } @else if (s.note) {
        <span class="note">{{ s.note }}</span>
      }
    }
  `,
  styles: [`
    .cancel { color: var(--app-status-action-fg); }
    .note { font-size: var(--app-font-xs); color: var(--app-color-text-sub); max-width: 260px; display: inline-block; line-height: 1.5; }
  `],
})
export class ProcedureCancelComponent {
  procedureId = input<string | null>(null);
  private functions = inject(Functions);
  private auth = inject(AuthService);
  private router = inject(Router);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(ProcedureCancelDialogService);

  busy = signal(false);
  state = signal<{ can: boolean; note: string | null; own: boolean; creatorName: string; proc: ProcedureSummary } | null>(null);

  constructor() {
    effect(() => { const id = this.procedureId(); if (id) void this.load(id); else this.state.set(null); });
  }

  private async load(id: string) {
    if (!this.auth.hasAnyRole('admin', 'operator')) { this.state.set(null); return; }
    try {
      const { data } = await httpsCallable<object, ProcedureSummary>(this.functions, 'procedureGet')({ companyId: this.auth.companyId, procedureId: id });
      if (data.status === 'completed' || data.status === 'cancelled') { this.state.set(null); return; }
      const own = data.createdBy === this.auth.profile()?.uid;
      const creatorName = own ? '' : (data.createdByName ?? '始めた人');
      const can = own || this.auth.hasRole('admin');
      this.state.set({ can, own, creatorName, proc: data, note: can ? null : `この手続きは${creatorName}さんが始めました。やめるときは${creatorName}さんか管理者に頼んでください` });
    } catch {
      this.state.set(null);
    }
  }

  async cancel() {
    const s = this.state();
    if (!s) return;
    const reason = await this.dialog.ask({ title: s.proc.title, own: s.own, creatorName: s.creatorName });
    if (reason === null) return;
    this.busy.set(true);
    try {
      await httpsCallable(this.functions, 'procedureCancel')({ companyId: this.auth.companyId, procedureId: this.procedureId(), reason, expectedVersion: s.proc.version });
      this.snackBar.open(`「${s.proc.title}」をやめました`, '閉じる', { duration: 4000 });
      void this.router.navigate(['/procedures']);
    } catch (e: unknown) {
      this.snackBar.open(e instanceof Error ? e.message : 'やめられませんでした', '閉じる', { duration: 8000 });
    } finally {
      this.busy.set(false);
    }
  }
}
