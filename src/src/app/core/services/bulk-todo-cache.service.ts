import { Injectable, inject } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { filter } from 'rxjs/operators';
import { AuthService } from './auth.service';

/** homeBulkTodo に渡す1件（事業所×月、算定は年） */
export interface BulkTodoTarget { kind: 'monthly' | 'santei' | 'bonus'; officeId: string; period: string }

/** 覚えておく時間。ホームと手続きの一覧を行き来するたびに、同じ重い集計をし直さないため */
const TTL_MS = 2 * 60_000;
/** この画面に入ったら覚えた結果を捨てる（処理や承認で、次にやることが変わるため） */
const INVALIDATING_ROUTES = ['/monthly', '/salary', '/premium', '/santei', '/bonus', '/approvals', '/filings'];

/**
 * 毎月の処理・算定・賞与の「次にやること」（homeBulkTodo）を、画面の側で少しの間覚えておく。
 * 1件に数秒かかる集計なので、同じ件を同時に頼まれたら1回にまとめ、2分以内なら覚えた結果を返す
 */
@Injectable({ providedIn: 'root' })
export class BulkTodoCacheService {
  private functions = inject(Functions);
  private auth = inject(AuthService);
  private cache = new Map<string, { at: number; value: Promise<unknown> }>();

  constructor() {
    inject(Router).events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd)).subscribe((e) => {
      const path = e.urlAfterRedirects.split(/[?#]/)[0];
      if (INVALIDATING_ROUTES.some((r) => path === r || path.startsWith(r + '/'))) this.clear();
    });
  }

  /** force なら覚えた結果を使わずに読み直す（「最新にする」） */
  get<T>(target: BulkTodoTarget, force = false): Promise<{ item: T | null }> {
    const key = [this.auth.companyId, target.kind, target.officeId, target.period].join('|');
    const hit = this.cache.get(key);
    if (!force && hit && Date.now() - hit.at < TTL_MS) return hit.value as Promise<{ item: T | null }>;
    const value = httpsCallable<object, { item: T | null }>(this.functions, 'homeBulkTodo', { timeout: 60_000 })({
      companyId: this.auth.companyId, kind: target.kind, officeId: target.officeId, period: target.period,
    }).then(({ data }) => data);
    this.cache.set(key, { at: Date.now(), value });
    // 失敗したものは覚えない（次に開いたときに読み直す）
    value.catch(() => { if (this.cache.get(key)?.value === value) this.cache.delete(key); });
    return value;
  }

  clear() { this.cache.clear(); }
}
