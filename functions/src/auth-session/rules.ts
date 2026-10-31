// ログインとセッションの決まり（カタログ14章。docs/stage8-plan.md）

/** 続けて何回失敗したらロックするか */
export const MAX_FAILURES = 5;
/** ロックの長さ */
export const LOCK_MINUTES = 30;
/** ログインから何時間でセッションを切るか */
export const SESSION_HOURS = 8;
/** 何分操作がなければセッションを切るか */
export const IDLE_MINUTES = 30;
/** 前に使ったパスワードをいくつ覚えておくか */
export const PASSWORD_HISTORY = 5;

const MINUTE = 60 * 1000;

/** パスワードのポリシー：8文字以上、英字と数字の両方を含む。満たさないときは理由を返す */
export function passwordProblem(password: string): string | null {
  if (password.length < 8) return '8文字以上にしてください';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return '英字と数字の両方を含めてください';
  return null;
}

export interface LoginGuard {
  failures: number;
  lockedUntil: number | null;
}

/** 今ロック中か（ロックの時刻を過ぎていれば解ける） */
export function isLocked(guard: LoginGuard | null, now: number): boolean {
  return !!guard?.lockedUntil && guard.lockedUntil > now;
}

/** 失敗を1回足した後の状態。ロックが明けた後の失敗は1回目から数え直す */
export function afterFailure(guard: LoginGuard | null, now: number): LoginGuard {
  const expired = !!guard?.lockedUntil && guard.lockedUntil <= now;
  const failures = (expired ? 0 : guard?.failures ?? 0) + 1;
  return {
    failures,
    lockedUntil: failures >= MAX_FAILURES ? now + LOCK_MINUTES * MINUTE : null,
  };
}

export interface SessionTimes {
  createdAt: number;
  lastActiveAt: number;
  revokedAt: number | null;
}

/** セッションが使えないときは理由を返す */
export function sessionProblem(s: SessionTimes | null, now: number): string | null {
  if (!s) return 'ログインし直してください';
  if (s.revokedAt) return 'この端末のログインは切断されました。ログインし直してください';
  if (now - s.createdAt > SESSION_HOURS * 60 * MINUTE) return `ログインから${SESSION_HOURS}時間たちました。ログインし直してください`;
  if (now - s.lastActiveAt > IDLE_MINUTES * MINUTE) return `${IDLE_MINUTES}分以上操作がなかったため、ログアウトしました`;
  return null;
}

/** 許可ドメインが設定されていれば、メールアドレスのドメインがそのどれかか */
export function domainAllowed(email: string, allowed: string[] | undefined): boolean {
  if (!allowed || allowed.length === 0) return true;
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  return allowed.some((d) => d.toLowerCase().replace(/^@/, '') === domain);
}
