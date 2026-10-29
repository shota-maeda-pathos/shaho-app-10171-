import { Injectable, inject, NgZone, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';

const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll'];

@Injectable({ providedIn: 'root' })
export class SessionTimeoutService implements OnDestroy {
  private router = inject(Router);
  private auth = inject(AuthService);
  private zone = inject(NgZone);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners: (() => void)[] = [];

  start() {
    this.zone.runOutsideAngular(() => {
      for (const event of ACTIVITY_EVENTS) {
        const handler = () => this.resetTimer();
        document.addEventListener(event, handler, { passive: true });
        this.listeners.push(() => document.removeEventListener(event, handler));
      }
      this.resetTimer();
    });
  }

  private resetTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.zone.run(() => this.handleTimeout());
    }, SESSION_TIMEOUT_MS);
  }

  private async handleTimeout() {
    if (!this.auth.isLoggedIn()) return;
    await this.auth.logout();
    await this.router.navigate(['/login'], { queryParams: { reason: 'timeout' } });
  }

  stop() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.listeners.forEach((fn) => fn());
    this.listeners = [];
  }

  ngOnDestroy() { this.stop(); }
}
