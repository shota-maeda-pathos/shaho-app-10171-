import { Injectable, inject, signal } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from './auth.service';

/** サイドバーの「承認」に出す、自分が承認できる承認待ちの件数。1分ごとと、承認の操作のあとに読み直す */
@Injectable({ providedIn: 'root' })
export class ApprovalBadgeService {
  private functions = inject(Functions);
  private auth = inject(AuthService);
  private timer: ReturnType<typeof setInterval> | null = null;

  count = signal(0);

  start() {
    if (this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), 60_000);
  }

  async refresh() {
    if (!this.auth.hasAnyRole('admin', 'approver')) { this.count.set(0); return; }
    try {
      const { data } = await httpsCallable<object, { forMe: number }>(this.functions, 'approvalBadgeGet')({ companyId: this.auth.companyId });
      this.count.set(data.forMe);
    } catch {
      // バッジは補助の表示なので、読めなくても画面は止めない
    }
  }
}
