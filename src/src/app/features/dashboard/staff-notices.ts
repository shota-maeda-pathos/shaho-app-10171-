import { Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../core/services/auth.service';
import { canOpenRoute } from '../../core/utils/route-access';

interface StaffNotice {
  id: string; title: string; body: string; category: string; isRead: boolean; createdAt: string;
  /** 押したときに開く画面（なければ既読にするだけ） */
  link: { route: string; queryParams: Record<string, string> } | null;
}

/**
 * ホームの「お知らせ」：承認の依頼・承認・差戻し・模擬電子申請の結果・承認の自動取消など（サーバーの staffNotificationList）。
 * 管理者はすべて、担当者・承認者は担当事業所のものだけ。押すと既読にし、関係する画面があればそこを開く
 */
@Component({
  selector: 'app-staff-notices',
  standalone: true,
  imports: [DatePipe],
  template: `
    <section class="card" aria-labelledby="notice-heading">
      <div class="card-head">
        <h2 id="notice-heading">お知らせ</h2>
        @if (unread()) { <span class="count" aria-label="未読">{{ unread() }}</span> }
        @if (unread()) { <button type="button" class="right link" (click)="markAll()" [disabled]="busy()">すべて既読にする</button> }
      </div>
      @if (items(); as list) {
        @if (list.length) {
          <ul class="card-body list">
            @for (n of list; track n.id) {
              <li [class.unread]="!n.isRead">
                <button type="button" (click)="open(n)" [attr.aria-label]="(n.isRead ? '' : '未読：') + n.title + (canOpen(n) ? '（開く）' : '')">
                  <span class="t">{{ n.title }}</span>
                  <span class="b">{{ n.body }}</span>
                  <span class="d">{{ n.createdAt | date:'M/d H:mm' }}@if (canOpen(n)) {<span class="go">・開く →</span>}</span>
                </button>
              </li>
            }
          </ul>
        } @else {
          <p class="card-body muted">まだお知らせはありません。</p>
        }
      } @else if (error()) {
        <p class="card-body muted" role="alert">お知らせを読み込めませんでした。<button type="button" class="link" (click)="load()">読み込み直す</button></p>
      } @else {
        <p class="card-body muted" role="status">読み込んでいます…</p>
      }
    </section>
  `,
  styles: [`
    .card { background: var(--app-color-surface); border: 1px solid var(--app-color-border); border-radius: var(--app-radius); box-shadow: var(--app-shadow); }
    .card-head { display: flex; align-items: center; gap: 8px; padding: 14px 18px; border-bottom: 1px solid var(--app-color-border-sub); }
    .card-head h2 { margin: 0; font-size: 15px; font-weight: 700; }
    .count { min-width: 20px; padding: 0 6px; border-radius: 10px; background: var(--app-color-primary); color: #fff; font-size: 12px; text-align: center; }
    .right { margin-left: auto; }
    .link { border: 0; background: none; padding: 0; color: var(--app-color-primary); font: inherit; font-size: var(--app-font-xs); cursor: pointer; }
    .card-body { margin: 0; padding: 8px 18px 12px; }
    .muted { color: var(--app-color-text-sub); font-size: var(--app-font-sm, 13px); }
    .list { list-style: none; max-height: 360px; overflow: auto; }
    .list li + li { border-top: 1px solid var(--app-color-border-sub); }
    .list button { display: grid; gap: 2px; width: 100%; padding: 8px 0; border: 0; background: none; text-align: left; font: inherit; color: inherit; cursor: pointer; }
    .t { font-size: 13px; }
    .b { font-size: 12px; color: var(--app-color-text-sub); line-height: 1.5; white-space: pre-line; }
    .d { font-size: 11px; color: var(--app-color-text-sub); }
    .go { color: var(--app-color-primary); }
    .unread .t { font-weight: 700; }
    .unread .t::before { content: ''; display: inline-block; width: 7px; height: 7px; margin-right: 6px; border-radius: 50%; background: var(--app-color-primary); vertical-align: middle; }
  `],
})
export class StaffNoticesComponent implements OnInit {
  private functions = inject(Functions);
  private router = inject(Router);
  private auth = inject(AuthService);
  items = signal<StaffNotice[] | null>(null);
  unread = signal(0);
  error = signal(false);
  busy = signal(false);

  ngOnInit() { void this.load(); }

  async load() {
    this.error.set(false);
    try {
      const { data } = await httpsCallable<object, { items: StaffNotice[]; unread: number }>(this.functions, 'staffNotificationList')({ companyId: this.auth.companyId, limit: 10 });
      this.items.set(data.items);
      this.unread.set(data.unread);
    } catch {
      this.error.set(true);
    }
  }

  /** 既読にして、関係する画面があれば開く（既読にできなくても開く） */
  async open(n: StaffNotice) {
    if (!n.isRead) await this.mark([n.id]).catch(() => undefined);
    if (n.link && this.canOpen(n)) void this.router.navigate([n.link.route], { queryParams: n.link.queryParams });
  }

  /** 自分のロールで開けない画面（承認者にとっての届出など）は「開く」を出さない */
  canOpen(n: StaffNotice) { return !!n.link && canOpenRoute(n.link.route, this.auth); }

  async markAll() {
    const ids = (this.items() ?? []).filter(n => !n.isRead).map(n => n.id);
    if (ids.length) await this.mark(ids, true);
  }

  private async mark(ids: string[], all = false) {
    this.busy.set(true);
    try {
      await httpsCallable(this.functions, 'notificationMarkRead')({ companyId: this.auth.companyId, notificationIds: ids });
      this.items.update(list => (list ?? []).map(n => (ids.includes(n.id) ? { ...n, isRead: true } : n)));
      // 「すべて既読」は表示中の10件だけを既読にするので、未読の数は読み直す
      if (all) await this.load(); else this.unread.update(c => Math.max(0, c - ids.length));
    } finally {
      this.busy.set(false);
    }
  }
}
