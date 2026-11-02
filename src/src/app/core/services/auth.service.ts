import { Injectable, inject, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import {
  Auth, GoogleAuthProvider, User, onAuthStateChanged, signInWithCustomToken, signInWithPopup, signOut,
} from '@angular/fire/auth';
import { Firestore, doc, getDoc, onSnapshot } from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';

export type Role = 'admin' | 'approver' | 'operator' | 'viewer' | 'employee';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  roles: Role[];
  officeIds: string[];
  employeeId: string | null;
  isSuspended: boolean;
  isLoginDisabled: boolean;
  companyId: string;
}

export interface LoginResult {
  token: string;
  sessionId: string;
  expiresAt: string;
  mustChangePassword: string | null;
}

/**
 * ログインはサーバーの関数（authLogin・authGoogleLogin）を通す（docs/stage8-plan.md の#4）。
 * 関数がパスワードやロック・許可ドメインを確かめ、セッション番号（sid）つきのトークンを返す。
 * Firebase に直接ログインしたトークンには sid がなく、サーバーもルールも受け付けない
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private auth = inject(Auth);
  private firestore = inject(Firestore);
  private functions = inject(Functions);
  private router = inject(Router);

  private _user = signal<User | null>(null);
  private _profile = signal<UserProfile | null>(null);
  private _loading = signal(true);
  private _sessionId = signal<string | null>(null);
  private _sessionExpiresAt = signal<number | null>(null);
  private unwatchSession: (() => void) | null = null;
  /** Google で本人を確かめている途中（まだ sid のないログイン）。この間は自動のログアウトをしない */
  private verifyingGoogle = false;

  readonly user = this._user.asReadonly();
  readonly profile = this._profile.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly sessionId = this._sessionId.asReadonly();
  readonly sessionExpiresAt = this._sessionExpiresAt.asReadonly();
  readonly isLoggedIn = computed(() => this._user() !== null);
  /** ログインのあとにパスワードを変えてもらう理由（弱い・前に使ったもの） */
  readonly mustChangePassword = signal<string | null>(null);
  /** セッションが終わった理由（ログイン画面に出す） */
  readonly endedReason = signal<string | null>(null);

  readonly companyId = 'company-001';

  constructor() {
    onAuthStateChanged(this.auth, async (user) => {
      this._loading.set(true);
      this._profile.set(null);
      this.stopWatchingSession();
      try {
        const sid = user ? (await user.getIdTokenResult()).claims['sid'] : null;
        if (user && typeof sid !== 'string') {
          if (this.verifyingGoogle) return;
          // 以前の方式（直接ログイン）のまま残っていたログイン。ログインし直してもらう
          this._user.set(null);
          await signOut(this.auth);
          return;
        }
        this._user.set(user);
        this._sessionId.set(typeof sid === 'string' ? sid : null);
        if (user && typeof sid === 'string') {
          await this.loadProfile(user.uid);
          this.watchSession(sid);
        }
      } catch (error) {
        console.error('ユーザー情報の取得に失敗しました', error);
      } finally {
        this._loading.set(false);
      }
    });
  }

  private async loadProfile(uid: string): Promise<void> {
    const ref = doc(this.firestore, `companies/${this.companyId}/users/${uid}`);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const data = snap.data();
      // 退職した人は、喪失日から閲覧専用、閲覧期間の翌日からログイン停止（サーバーと同じ判定）
      const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
      const reached = (v: unknown) => typeof v === 'string' && v <= today;
      this._profile.set({
        uid,
        email: data['email'],
        displayName: data['displayName'],
        roles: Array.isArray(data['roles']) ? data['roles'] : [],
        officeIds: data['officeIds'] ?? [],
        employeeId: data['employeeId'] ?? null,
        isSuspended: (data['isSuspended'] ?? false) || reached(data['suspendFrom']),
        isLoginDisabled: (data['isLoginDisabled'] ?? false) || reached(data['loginDisabledFrom']),
        companyId: this.companyId,
      });
    }
  }

  /** 自分のセッションを見張り、ほかの端末から切断されたらすぐログアウトする */
  private watchSession(sid: string) {
    const ref = doc(this.firestore, `companies/${this.companyId}/sessions/${sid}`);
    this.unwatchSession = onSnapshot(ref, (snap) => {
      const d = snap.data();
      if (!d) return;
      this._sessionExpiresAt.set(d['expiresAt']?.toMillis?.() ?? null);
      if (d['revokedAt'] && d['revokedReason'] !== 'logout') {
        void this.endSession('この端末のログインは切断されました。ログインし直してください');
      }
    }, () => { /* 読めないとき（ログアウト直後など）は何もしない */ });
  }

  private stopWatchingSession() {
    this.unwatchSession?.();
    this.unwatchSession = null;
    this._sessionExpiresAt.set(null);
  }

  private async finishLogin(result: LoginResult): Promise<void> {
    this.endedReason.set(null);
    this.mustChangePassword.set(result.mustChangePassword);
    // Google で本人を確かめたときは、同じ人（同じ uid）でログインしたままになっている。そのまま
    // セッションつきのトークンでログインし直しても「ログインの状態が変わった」と通知されず、画面が進まないので、いったん抜ける
    if (this.auth.currentUser) await signOut(this.auth);
    await signInWithCustomToken(this.auth, result.token);
  }

  async login(email: string, password: string): Promise<void> {
    const fn = httpsCallable<object, LoginResult>(this.functions, 'authLogin');
    const { data } = await fn({ companyId: this.companyId, email, password, userAgent: navigator.userAgent });
    await this.finishLogin(data);
  }

  /** Google で本人を確かめたあと、許可ドメインと利用者の登録をサーバーで確かめる */
  async loginWithGoogle(): Promise<void> {
    this.verifyingGoogle = true;
    try {
      const cred = await signInWithPopup(this.auth, new GoogleAuthProvider());
      const idToken = await cred.user.getIdToken();
      const fn = httpsCallable<object, LoginResult>(this.functions, 'authGoogleLogin');
      const { data } = await fn({ companyId: this.companyId, idToken, userAgent: navigator.userAgent });
      await this.finishLogin(data);
    } catch (e) {
      await signOut(this.auth);
      throw e;
    } finally {
      this.verifyingGoogle = false;
    }
  }

  /** 招待を受けて登録する（パスワードか Google） */
  async acceptInvitation(input: { invitationId: string; displayName: string; password?: string; google?: boolean }): Promise<void> {
    let idToken: string | undefined;
    this.verifyingGoogle = !!input.google;
    try {
      if (input.google) {
        const cred = await signInWithPopup(this.auth, new GoogleAuthProvider());
        idToken = await cred.user.getIdToken();
      }
      const fn = httpsCallable<object, LoginResult>(this.functions, 'authInvitationAccept');
      const { data } = await fn({
        companyId: this.companyId, invitationId: input.invitationId, displayName: input.displayName,
        ...(idToken ? { idToken } : { password: input.password }), userAgent: navigator.userAgent,
      });
      await this.finishLogin(data);
    } catch (e) {
      if (idToken) await signOut(this.auth);
      throw e;
    } finally {
      this.verifyingGoogle = false;
    }
  }

  async logout(): Promise<void> {
    if (this._sessionId()) {
      try {
        await httpsCallable(this.functions, 'authLogout')({ companyId: this.companyId });
      } catch { /* セッションが切れていても画面からはログアウトする */ }
    }
    this.mustChangePassword.set(null);
    await signOut(this.auth);
  }

  /** セッションが終わったとき（切断・8時間・無操作）。理由をログイン画面に出す */
  async endSession(reason: string): Promise<void> {
    this.endedReason.set(reason);
    this.stopWatchingSession();
    this.mustChangePassword.set(null);
    await signOut(this.auth);
    await this.router.navigate(['/login']);
  }

  /** 操作していることをサーバーに知らせる（サーバー側の無操作30分の判定に使う） */
  async ping(): Promise<void> {
    try {
      await httpsCallable(this.functions, 'authPing')({ companyId: this.companyId });
    } catch (e: any) {
      if (String(e?.message ?? '').includes('SESSION_')) {
        await this.endSession(String(e.message).replace(/（SESSION_[A-Z]+）/, ''));
      }
    }
  }

  hasRole(role: Role): boolean {
    return this._profile()?.roles.includes(role) ?? false;
  }

  hasAnyRole(...roles: Role[]): boolean {
    const userRoles = this._profile()?.roles ?? [];
    return roles.some((r) => userRoles.includes(r));
  }
}
