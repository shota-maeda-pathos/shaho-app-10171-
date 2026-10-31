import { Injectable, inject, NgZone, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';

const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll'];
/** 操作しているあいだ、サーバーに知らせる間隔（サーバーも無操作30分で切るため） */
const PING_INTERVAL_MS = 5 * 60 * 1000;
/** ログインから8時間の期限を確かめる間隔 */
const EXPIRY_CHECK_MS = 30 * 1000;

@Injectable({ providedIn: 'root' })
export class SessionTimeoutService implements OnDestroy {
  private router = inject(Router);
  private auth = inject(AuthService);
  private zone = inject(NgZone);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private expiryTimer: ReturnType<typeof setInterval> | null = null;
  private listeners: (() => void)[] = [];
  private lastPing = 0;

  start() {
    this.zone.runOutsideAngular(() => {
      for (const event of ACTIVITY_EVENTS) {
        const handler = () => this.onActivity();
        document.addEventListener(event, handler, { passive: true });
        this.listeners.push(() => document.removeEventListener(event, handler));
      }
      this.resetTimer();
      this.expiryTimer = setInterval(() => {
        const expiresAt = this.auth.sessionExpiresAt();
        if (this.auth.isLoggedIn() && expiresAt && Date.now() >= expiresAt) {
          this.zone.run(() => this.end('ログインから8時間たちました。ログインし直してください'));
        }
      }, EXPIRY_CHECK_MS);
    });
  }

  private onActivity() {
    this.resetTimer();
    if (this.auth.isLoggedIn() && Date.now() - this.lastPing > PING_INTERVAL_MS) {
      this.lastPing = Date.now();
      void this.auth.ping();
    }
  }

  private resetTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.zone.run(() => this.handleTimeout());
    }, SESSION_TIMEOUT_MS);
  }

  private async handleTimeout() {
    if (!this.auth.isLoggedIn()) return;
    await this.end('30分以上操作がなかったため、ログアウトしました');
  }

  private async end(reason: string) {
    if (!this.auth.isLoggedIn()) return;
    await this.auth.endSession(reason);
    await this.router.navigate(['/login']);
  }

  stop() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.expiryTimer) { clearInterval(this.expiryTimer); this.expiryTimer = null; }
    this.listeners.forEach((fn) => fn());
    this.listeners = [];
  }

  ngOnDestroy() { this.stop(); }
}
