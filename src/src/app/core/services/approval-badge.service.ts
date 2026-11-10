import { Injectable, inject, signal } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from './auth.service';

/** 画面を移ったときに読み直す間隔の下限。続けて画面を移っても、この間は読み直さない */
const NAVIGATION_MIN_INTERVAL_MS = 15_000;

/**
 * サイドバーの「承認」に出す、自分が承認できる承認待ちの件数。
 * 1分ごと（タブが見えているときだけ）、画面を移ったとき（15秒に1回まで）、承認の操作のあと（すぐ）に読み直す
 */
@Injectable({ providedIn: 'root' })
export class ApprovalBadgeService {
  private functions = inject(Functions);
  private auth = inject(AuthService);
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<void> | null = null;
  private lastRefreshedAt = 0;

  count = signal(0);

  start() {
    if (this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void this.refresh();
    }, 60_000);
  }

  /** 画面を移ったとき。直前に読んだばかりなら読み直さない */
  refreshOnNavigation() {
    if (Date.now() - this.lastRefreshedAt < NAVIGATION_MIN_INTERVAL_MS) return;
    void this.refresh();
  }

  /**
   * すぐ読み直す（承認の操作のあとなど）。読み込み中なら、それが終わってからもう一度読む
   * （操作の前に始まった読み込みの古い件数で終わらないように）
   */
  async refresh(): Promise<void> {
    if (this.inFlight) await this.inFlight;
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.load().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async load() {
    this.lastRefreshedAt = Date.now();
    if (!this.auth.hasAnyRole('admin', 'approver')) { this.count.set(0); return; }
    try {
      const { data } = await httpsCallable<object, { forMe: number }>(this.functions, 'approvalBadgeGet')({ companyId: this.auth.companyId });
      this.count.set(data.forMe);
    } catch {
      // バッジは補助の表示なので、読めなくても画面は止めない
    }
  }
}
