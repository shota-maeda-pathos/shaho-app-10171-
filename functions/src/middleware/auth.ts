import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { sessionProblem } from '../auth-session/rules';

export type Role = 'admin' | 'operator' | 'approver' | 'viewer' | 'employee';

export interface AuthContext {
  uid: string;
  companyId: string;
  roles: Role[];
  officeIds: string[];
  employeeId?: string | null;
  isSuspended: boolean;
  isLoginDisabled: boolean;
  /** ログインの関数が作ったセッションの番号 */
  sessionId: string;
}

/** 1分あたりの呼び出しの上限（利用者ごと、関数の実体ごと。カタログ14章のレート制限） */
const RATE_LIMIT_PER_MINUTE = 300;
const callCounts = new Map<string, { minute: number; count: number }>();

function checkRateLimit(uid: string, now: number): void {
  const minute = Math.floor(now / 60000);
  const c = callCounts.get(uid);
  if (!c || c.minute !== minute) {
    callCounts.set(uid, { minute, count: 1 });
    return;
  }
  c.count += 1;
  if (c.count > RATE_LIMIT_PER_MINUTE) {
    throw new HttpsError('resource-exhausted', '操作が多すぎます。少し待ってからやり直してください');
  }
}

/** 最後の操作の時刻は1分に1回だけ書く（呼び出しのたびに書かない） */
const ACTIVE_WRITE_INTERVAL = 60 * 1000;

/**
 * ログインの関数（auth-session）が作ったセッションか確かめる。
 * Firebase に直接ログインしたトークンにはセッション番号（sid）がないので拒む
 */
async function checkSession(companyId: string, sid: unknown, now: number): Promise<string> {
  if (typeof sid !== 'string' || !sid) {
    throw new HttpsError('unauthenticated', 'ログインし直してください（SESSION_REQUIRED）');
  }
  const ref = getFirestore().doc(`companies/${companyId}/sessions/${sid}`);
  const snap = await ref.get();
  const d = snap.data();
  const problem = sessionProblem(
    d
      ? {
          createdAt: d.createdAt.toMillis(),
          lastActiveAt: d.lastActiveAt.toMillis(),
          revokedAt: d.revokedAt ? d.revokedAt.toMillis() : null,
        }
      : null,
    now,
  );
  if (problem) throw new HttpsError('unauthenticated', `${problem}（SESSION_ENDED）`);
  if (now - d!.lastActiveAt.toMillis() > ACTIVE_WRITE_INTERVAL) {
    await ref.update({ lastActiveAt: Timestamp.fromMillis(now) });
  }
  return sid;
}

export async function getAuthContext(
  request: CallableRequest,
  companyId: string,
): Promise<AuthContext> {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', '認証が必要です');
  }
  const uid = request.auth.uid;
  const now = Date.now();
  checkRateLimit(uid, now);
  const [sessionId, userDoc] = await Promise.all([
    checkSession(companyId, request.auth.token.sid, now),
    getFirestore().doc(`companies/${companyId}/users/${uid}`).get(),
  ]);
  if (!userDoc.exists) {
    throw new HttpsError('permission-denied', 'この会社へのアクセス権がありません');
  }
  const data = userDoc.data()!;
  // 退職した人は、喪失日（退職日の翌日）から閲覧専用、閲覧期間の翌日からログイン停止（日付は東京の今日で比べる）
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const reached = (v: unknown) => typeof v === 'string' && v <= today;
  return {
    uid,
    companyId,
    sessionId,
    roles: data.roles ?? [],
    officeIds: data.officeIds ?? [],
    employeeId: typeof data.employeeId === 'string' ? data.employeeId : null,
    isSuspended: (data.isSuspended ?? false) || reached(data.suspendFrom),
    isLoginDisabled: (data.isLoginDisabled ?? false) || reached(data.loginDisabledFrom),
  };
}

export function requireLoginEnabled(auth: AuthContext): void {
  if (auth.isLoginDisabled) {
    throw new HttpsError('permission-denied', 'ログインが禁止されています');
  }
}

export function requireNotSuspended(auth: AuthContext): void {
  if (auth.isSuspended) {
    throw new HttpsError('permission-denied', 'アカウントが停止されています');
  }
}

export function requireRole(auth: AuthContext, ...roles: Role[]): void {
  requireLoginEnabled(auth);
  requireNotSuspended(auth);
  if (!roles.some((r) => auth.roles.includes(r))) {
    throw new HttpsError('permission-denied', '権限がありません');
  }
}

export function isSelfAccess(
  auth: AuthContext,
  recordUserId: string | null,
): boolean {
  return !auth.isLoginDisabled && recordUserId === auth.uid;
}

export function requireOffice(auth: AuthContext, officeId: string): void {
  if (auth.roles.includes('admin')) return;
  if (!auth.officeIds.includes(officeId)) {
    throw new HttpsError('permission-denied', '担当事業所外です');
  }
}
