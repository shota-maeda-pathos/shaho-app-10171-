import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../core/services/auth.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm-dialog';
import { PageHeadComponent } from '../../shared/ui';

interface RequestItem {
  id: string; type: 'address' | 'name' | 'dependentAdd' | 'dependentRemove' | 'leave'; typeLabel: string;
  employeeId: string; employeeName: string; status: string; detail: Record<string, unknown>; note: string | null;
  attachments: { name: string; size: number }[]; comment: string | null; createdAt: string | null;
}

const STATUS_LABELS: Record<string, string> = { submitted: '受付待ち', inProgress: '手続き中', done: '完了', rejected: '差し戻し' };
const DETAIL_LABELS: Record<string, string> = {
  postalCode: '郵便番号', prefecture: '都道府県', city: '市区町村', addressLine: '番地', building: '建物', movedOn: '引っ越した日',
  lastName: '姓', firstName: '名', lastNameKana: '姓（カナ）', firstNameKana: '名（カナ）', changedOn: '変わった日',
  birthDate: '生年月日', relationship: '続柄', coResident: '同居', annualIncome: '年収の見込み', since: '日付',
  dependentName: '家族の氏名', reason: '理由', kind: '休業', startDate: '開始日', endDate: '終了予定日', expectedBirthDate: '出産予定日',
  childLastName: '子の姓', childFirstName: '子の名', childBirthDate: '子の生年月日', gender: '性別',
};
const VALUE_LABELS: Record<string, string> = {
  spouse: '配偶者', child: '子', parent: '父母', grandparent: '祖父母', sibling: '兄弟姉妹', grandchild: '孫', other: 'その他',
  maternity: '産前産後休業', childcare: '育児休業', true: 'はい', false: 'いいえ', male: '男', female: '女',
};

/**
 * 本人からの申請を担当者が受け付ける画面（カタログ11章）。
 * 住所・氏名は確かめて台帳に反映。扶養・産休育休はウィザードを始めて、申請の中身を見ながら入力する
 */
@Component({
  selector: 'app-portal-request-list',
  standalone: true,
  imports: [DatePipe, FormsModule, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatInputModule, PageHeadComponent],
  template: `
    <app-page-head heading="本人からの申請">
      <span meta>従業員が本人ポータルから出した申請です。確かめて手続きに取り込みます。</span>
      <mat-checkbox actions [(ngModel)]="includeClosed" (change)="load()">終わった申請も表示</mat-checkbox>
    </app-page-head>
    @if (error()) { <p class="error">{{ error() }}</p> }
    @for (r of items(); track r.id) {
      <section class="card">
        <div class="head"><b>{{ r.employeeName }}</b>・{{ r.typeLabel }}<span class="status">{{ statusLabel(r.status) }}</span><span class="date">{{ r.createdAt | date: 'yyyy/M/d H:mm' }}</span></div>
        <dl class="rows">@for (kv of details(r); track kv[0]) { <dt>{{ kv[0] }}</dt><dd>{{ kv[1] }}</dd> }</dl>
        @if (r.note) { <p class="note">本人から：{{ r.note }}</p> }
        @if (r.attachments.length) {
          <p class="files">添付：@for (a of r.attachments; track $index) { <button mat-button type="button" (click)="download(r, $index)">{{ a.name }}</button> }</p>
        }
        @if (r.status === 'submitted' || r.status === 'inProgress') {
          <mat-form-field appearance="outline" class="comment"><mat-label>本人への連絡（任意）</mat-label><input matInput [(ngModel)]="comments[r.id]" [name]="'c' + r.id"></mat-form-field>
          <div class="actions">
            @if (r.type === 'address' || r.type === 'name') {
              <button mat-flat-button color="primary" type="button" (click)="apply(r)" [disabled]="busy()">台帳に反映する</button>
            } @else if (r.status === 'submitted') {
              <button mat-flat-button color="primary" type="button" (click)="startWizard(r)" [disabled]="busy()">{{ r.type === 'leave' ? '休業の手続きを始める' : '扶養の手続きを始める' }}</button>
            } @else {
              <button mat-flat-button color="primary" type="button" (click)="act(r, 'done')" [disabled]="busy()">完了にする</button>
            }
            <button mat-button color="warn" type="button" (click)="act(r, 'reject')" [disabled]="busy()">差し戻す</button>
          </div>
        } @else if (r.comment) { <p class="note">本人への連絡：{{ r.comment }}</p> }
      </section>
    } @empty {
      @if (!loading()) { <p class="sub">対応する申請はありません。</p> } @else { <p class="sub">読み込み中…</p> }
    }
  `,
  styles: [`
    :host { display: block; padding: var(--app-space-5); max-width: 960px; }
    .card { background: var(--app-color-surface); border: 1px solid var(--app-color-border); border-radius: var(--app-radius); padding: var(--app-space-4); margin-bottom: var(--app-space-3); }
    .head { display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; margin-bottom: var(--app-space-2); }
    .status { padding: 1px 8px; border-radius: 4px; background: var(--app-status-action-bg); color: var(--app-status-action-fg); font-size: var(--app-font-xs); font-weight: 600; }
    .date { color: var(--app-color-text-sub); font-size: var(--app-font-sm); }
    .rows { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 0 0 var(--app-space-2); font-size: var(--app-font-sm); }
    dt { color: var(--app-color-text-sub); } dd { margin: 0; }
    .note, .files { font-size: var(--app-font-sm); margin: 0 0 var(--app-space-2); }
    .comment { width: 100%; max-width: 480px; }
    .actions { display: flex; gap: 8px; }
    .error { color: var(--app-status-error-fg); } .sub { color: var(--app-color-text-sub); }
  `],
})
export class PortalRequestListComponent implements OnInit {
  private functions = inject(Functions);
  private auth = inject(AuthService);
  private router = inject(Router);
  private snackBar = inject(MatSnackBar);
  private confirm = inject(ConfirmService);

  items = signal<RequestItem[]>([]);
  loading = signal(false);
  busy = signal(false);
  error = signal('');
  includeClosed = false;
  comments: Record<string, string> = {};

  ngOnInit() { void this.load(); }

  statusLabel(s: string) { return STATUS_LABELS[s] ?? s; }

  details(r: RequestItem): [string, string][] {
    return Object.entries(r.detail).map(([k, v]) => [DETAIL_LABELS[k] ?? k, VALUE_LABELS[String(v)] ?? (k === 'annualIncome' ? `${Number(v).toLocaleString()}円` : String(v))]);
  }

  async load() {
    this.loading.set(true);
    this.error.set('');
    try {
      const { data } = await httpsCallable<object, { items: RequestItem[] }>(this.functions, 'portalRequestList')({ companyId: this.auth.companyId, includeClosed: this.includeClosed });
      this.items.set(data.items);
    } catch (e: any) {
      this.error.set(`申請を取得できませんでした：${e?.message ?? ''}`);
    } finally {
      this.loading.set(false);
    }
  }

  private async handle(r: RequestItem, action: 'apply' | 'inProgress' | 'done' | 'reject') {
    await httpsCallable(this.functions, 'portalRequestHandle')({ companyId: this.auth.companyId, requestId: r.id, action, ...(this.comments[r.id] ? { comment: this.comments[r.id] } : {}) });
  }

  async apply(r: RequestItem) {
    const ok = await this.confirm.ask({
      title: `${r.employeeName}さんの${r.typeLabel}を台帳に反映しますか`,
      message: '従業員の台帳を申請の内容に書き換えます。前の値は監査ログに残ります。',
      items: this.details(r).map(([k, v]) => `${k}：${v}`),
      confirmLabel: '反映する',
    });
    if (ok) await this.run(() => this.handle(r, 'apply'), '台帳に反映しました');
  }

  async act(r: RequestItem, action: 'done' | 'reject') {
    if (action === 'reject') {
      const ok = await this.confirm.ask({ title: 'この申請を差し戻しますか', message: '本人にお知らせが届きます。理由を「本人への連絡」に書いてください。', confirmLabel: '差し戻す', warn: true });
      if (!ok) return;
    }
    await this.run(() => this.handle(r, action), action === 'done' ? '完了にしました' : '差し戻しました');
  }

  /** 扶養・休業のウィザードを始め、申請を「手続き中」にして移る */
  async startWizard(r: RequestItem) {
    this.busy.set(true);
    try {
      const leave = r.type === 'leave';
      const { data } = await httpsCallable<object, { procedureId: string }>(this.functions, leave ? 'leaveProcedureStart' : 'dependentChangeStart')({
        companyId: this.auth.companyId, employeeId: r.employeeId, sourceRequestId: r.id, ...(leave ? { kind: r.detail['kind'] } : {}),
      });
      await this.handle(r, 'inProgress');
      this.snackBar.open('手続きを始めました。申請の内容を入れてあるので、確かめて進めてください', '閉じる', { duration: 6000 });
      await this.router.navigate([leave ? '/leaves' : '/dependents', data.procedureId]);
    } catch (e: any) {
      this.snackBar.open(`始められませんでした：${e?.message ?? ''}`, '閉じる', { duration: 6000 });
    } finally {
      this.busy.set(false);
    }
  }

  async download(r: RequestItem, index: number) {
    try {
      const { data } = await httpsCallable<object, { name: string; contentType: string; dataBase64: string }>(this.functions, 'portalRequestAttachmentGet')({ companyId: this.auth.companyId, requestId: r.id, index });
      const bytes = Uint8Array.from(atob(data.dataBase64), c => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: data.contentType }));
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e: any) {
      this.snackBar.open(`開けませんでした：${e?.message ?? ''}`, '閉じる', { duration: 6000 });
    }
  }

  private async run(fn: () => Promise<void>, done: string) {
    this.busy.set(true);
    try {
      await fn();
      this.snackBar.open(done, '閉じる', { duration: 4000 });
      await this.load();
    } catch (e: any) {
      this.snackBar.open(`できませんでした：${e?.message ?? ''}`, '閉じる', { duration: 6000 });
    } finally {
      this.busy.set(false);
    }
  }
}
