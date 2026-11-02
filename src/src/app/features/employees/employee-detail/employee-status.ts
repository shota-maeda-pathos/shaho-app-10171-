import { Component, OnChanges, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../../core/services/auth.service';
import { errorMessage } from '../../onboarding/onboarding.types';

import { MatDatepickerModule } from '@angular/material/datepicker';
interface Period {
  kind: string; label: string; start: string; end: string | null; source: 'leave' | 'absence' | 'resignation';
  id: string | null; note: string | null; planned: boolean;
}
interface StatusView { today: string; kind: string; label: string; note: string | null; since: string | null; until: string | null; history: Period[] }

/**
 * 在籍ステータス（カタログ2章）。今の状態と日付つきの履歴を出し、休職（傷病休職・私傷病）だけをここで記録する。
 * 産休・育休・介護休業は休業の手続き、退職は退職の手続きの記録から自動で決まる
 */
@Component({
  selector: 'app-employee-status',
  standalone: true,
  imports: [MatDatepickerModule, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <section class="status" aria-label="在籍状態">
      <h3>在籍状態</h3>
      @if (view(); as v) {
        <p class="now"><strong>{{ v.label }}</strong>
          @if (v.since) { <span class="sub">（{{ v.since }}から{{ v.until ? '・' + v.until + 'まで' : '' }}）</span> }
        </p>
        @if (v.note) { <p class="note">{{ v.note }}</p> }
        @if (v.history.length) {
          <table class="history">
            <thead><tr><th>状態</th><th>期間</th><th>もと</th><th></th></tr></thead>
            <tbody>
              @for (p of v.history; track $index) {
                <tr>
                  <td>{{ p.label }}@if (p.planned) { <span class="sub">（予定を含む）</span> }</td>
                  <td>{{ p.start }}〜{{ p.end ?? '' }}</td>
                  <td>{{ sourceLabel(p) }}</td>
                  <td>
                    @if (p.source === 'absence' && canEdit) {
                      <button mat-button type="button" (click)="edit(p)" [disabled]="busy()">直す</button>
                      <button mat-button type="button" (click)="remove(p)" [disabled]="busy()">消す</button>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        } @else { <p class="sub">在籍中です。休業・休職・退職の記録はありません。</p> }

        @if (canEdit) {
          <details [open]="!!form.absenceId">
            <summary>{{ form.absenceId ? '休職の記録を直す' : '休職（傷病休職・私傷病）を記録する' }}</summary>
            <p class="sub">産休・育休・介護休業は「休業」のタブの手続きで、退職は退職の手続きで記録します。</p>
            <div class="fields">
              <mat-form-field appearance="outline"><mat-label>理由</mat-label>
                <mat-select [(ngModel)]="form.reason" name="absReason">
                  <mat-option value="injury">傷病休職</mat-option>
                  <mat-option value="personal">私傷病</mat-option>
                </mat-select></mat-form-field>
              <mat-form-field appearance="outline"><mat-label>開始日</mat-label><input matInput [(ngModel)]="form.startDate" name="absStart" [matDatepicker]="dp1" placeholder="YYYY/MM/DD"><mat-datepicker-toggle matIconSuffix [for]="dp1" /><mat-datepicker #dp1 /></mat-form-field>
              <mat-form-field appearance="outline"><mat-label>終了日（決まっていなければ空）</mat-label><input matInput [(ngModel)]="form.endDate" name="absEnd" [matDatepicker]="dp2" placeholder="YYYY/MM/DD"><mat-datepicker-toggle matIconSuffix [for]="dp2" /><mat-datepicker #dp2 /></mat-form-field>
              <mat-form-field appearance="outline" class="wide"><mat-label>メモ（任意）</mat-label><input matInput [(ngModel)]="form.note" name="absNote"></mat-form-field>
            </div>
            <button mat-flat-button type="button" (click)="save()" [disabled]="busy() || !form.startDate">{{ form.absenceId ? '直す' : '記録する' }}</button>
            @if (form.absenceId) { <button mat-button type="button" (click)="reset()">やめる</button> }
          </details>
        }
      } @else {
        <p class="sub" role="status">{{ error() || '読み込んでいます…' }}</p>
      }
    </section>
  `,
  styles: [`
    .status { margin: 8px 0 16px; }
    h3 { margin: 0 0 4px; font-size: 16px; }
    .now { margin: 4px 0; }
    .sub { color: var(--app-color-text-sub); font-size: 13px; }
    .note { padding: 6px 10px; border-radius: 8px; background: var(--app-status-yours-bg); }
    .history { border-collapse: collapse; font-size: 13px; margin: 8px 0; }
    .history th, .history td { padding: 4px 10px; border-bottom: 1px solid var(--app-color-border); text-align: left; }
    .history th { color: var(--app-color-text-sub); font-weight: 500; }
    .fields { display: flex; flex-wrap: wrap; gap: 0 12px; margin-top: 8px; }
    .fields mat-form-field { width: 200px; }
    .fields .wide { width: min(100%, 360px); }
    summary { cursor: pointer; color: var(--app-color-link); }
  `],
})
export class EmployeeStatusComponent implements OnChanges {
  private functions = inject(Functions);
  private auth = inject(AuthService);
  private snackBar = inject(MatSnackBar);

  employeeId = input.required<string>();
  view = signal<StatusView | null>(null);
  error = signal('');
  busy = signal(false);
  canEdit = this.auth.hasAnyRole('admin', 'operator');
  form: { absenceId: string | null; reason: 'injury' | 'personal'; startDate: string; endDate: string; note: string } = this.empty();

  private empty() { return { absenceId: null, reason: 'injury' as const, startDate: '', endDate: '', note: '' }; }

  ngOnChanges() { void this.load(); }

  sourceLabel(p: Period) {
    return p.source === 'leave' ? '休業の手続き' : p.source === 'resignation' ? '退職の手続き' : `休職の記録${p.note ? '（' + p.note + '）' : ''}`;
  }

  async load() {
    try {
      const { data } = await httpsCallable<object, StatusView>(this.functions, 'employeeStatusGet')({ companyId: this.auth.companyId, employeeId: this.employeeId() });
      this.view.set(data);
      this.error.set('');
    } catch (e) {
      this.error.set(errorMessage(e, '在籍状態を読み込めませんでした'));
    }
  }

  edit(p: Period) {
    const reason = p.note?.startsWith('私傷病') ? 'personal' : 'injury';
    const note = p.note?.includes('：') ? p.note.split('：').slice(1).join('：') : '';
    this.form = { absenceId: p.id, reason, startDate: p.start, endDate: p.end ?? '', note };
  }

  reset() { this.form = this.empty(); }

  async save() {
    this.busy.set(true);
    try {
      await httpsCallable(this.functions, 'employeeAbsenceSave')({
        companyId: this.auth.companyId, employeeId: this.employeeId(), action: 'save',
        ...(this.form.absenceId ? { absenceId: this.form.absenceId } : {}),
        reason: this.form.reason, startDate: this.form.startDate, endDate: this.form.endDate || null, ...(this.form.note.trim() ? { note: this.form.note.trim() } : {}),
      });
      this.snackBar.open('休職の記録を保存しました', '閉じる', { duration: 3000 });
      this.reset();
      await this.load();
    } catch (e) {
      this.snackBar.open(errorMessage(e, '保存できませんでした'), '閉じる', { duration: 8000 });
    } finally {
      this.busy.set(false);
    }
  }

  async remove(p: Period) {
    if (!p.id) return;
    this.busy.set(true);
    try {
      await httpsCallable(this.functions, 'employeeAbsenceSave')({ companyId: this.auth.companyId, employeeId: this.employeeId(), action: 'delete', absenceId: p.id });
      this.snackBar.open('休職の記録を消しました', '閉じる', { duration: 3000 });
      await this.load();
    } catch (e) {
      this.snackBar.open(errorMessage(e, '消せませんでした'), '閉じる', { duration: 8000 });
    } finally {
      this.busy.set(false);
    }
  }
}
