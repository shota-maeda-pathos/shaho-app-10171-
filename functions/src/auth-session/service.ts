import { getAuth } from 'firebase-admin/auth';
import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config';
import type { AuthContext } from '../middleware/auth';
import type { EmployeeDoc, InvitationDoc, UserDoc } from '../types/firestore';
import { checkPassword } from './identity';
import { emailKey, hashPassword, matchesHash } from './passwords';
import {
  IDLE_MINUTES,
  LOCK_MINUTES,
  LoginGuard,
  MAX_FAILURES,
  PASSWORD_HISTORY,
  SESSION_HOURS,
  afterFailure,
  domainAllowed,
  isLocked,
  passwordProblem,
} from './rules';
import type {
  ChangePasswordInput,
  GoogleLoginInput,
  InvitationAcceptInput,
  InvitationGetInput,
  LoginInput,
  RevokeSessionInput,
  UnlockInput,
} from './schema';

export interface Client {
  ip: string;
  userAgent: string;
}

export interface LoginResult {
  token: string;
  sessionId: string;
  expiresAt: string;
  /** パスワードを変えてもらう理由（弱い・前に使ったもの）。なければ null */
  mustChangePassword: string | null;
}

const base = (companyId: string) => `companies/${companyId}`;

/** ログインまわりの監査ログ（パスワードは残さない） */
function audit(
  companyId: string,
  action: string,
  actor: { uid: string | null; name?: string | null },
  client: Client,
  changes: Record<string, unknown> = {},
) {
  return db.collection(`${base(companyId)}/auditLogs`).add({
    entity: 'auth',
    entityId: actor.uid ?? 'anonymous',
    action,
    changes,
    performedBy: actor.uid ?? 'anonymous',
    performedByName: actor.name ?? null,
    ip: client.ip,
    userAgent: client.userAgent,
    performedAt: Timestamp.now(),
    version: 0,
  });
}

async function loadUser(companyId: string, uid: string): Promise<UserDoc | null> {
  const snap = await db.doc(`${base(companyId)}/users/${uid}`).get();
  return snap.exists ? (snap.data() as UserDoc) : null;
}

function loginBlocked(user: UserDoc): boolean {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  return user.isLoginDisabled || (typeof user.loginDisabledFrom === 'string' && user.loginDisabledFrom <= today);
}

/** セッションを作り、セッション番号つきのトークンを渡す（サーバーの認証はこの番号のないトークンを拒む） */
async function startSession(
  companyId: string,
  uid: string,
  method: 'password' | 'google',
  client: Client,
  mustChangePassword: string | null,
): Promise<LoginResult> {
  const now = Timestamp.now();
  const ref = db.collection(`${base(companyId)}/sessions`).doc();
  const expiresAt = Timestamp.fromMillis(now.toMillis() + SESSION_HOURS * 60 * 60 * 1000);
  await ref.set({
    uid,
    method,
    ip: client.ip,
    userAgent: client.userAgent,
    createdAt: now,
    lastActiveAt: now,
    expiresAt,
    revokedAt: null,
  });
  await db.doc(`${base(companyId)}/users/${uid}`).update({ lastLoginAt: now });
  const token = await getAuth().createCustomToken(uid, { sid: ref.id });
  return { token, sessionId: ref.id, expiresAt: expiresAt.toDate().toISOString(), mustChangePassword };
}

/**
 * パスワードの指紋を覚えておき、前に使ったものかを確かめる。
 * メールでのリセットは Firebase の画面で行うため、ここでは「今の指紋と違う」＝変わったと分かる
 */
async function trackPassword(companyId: string, uid: string, password: string): Promise<string | null> {
  const ref = db.doc(`${base(companyId)}/userSecrets/${uid}`);
  const snap = await ref.get();
  const current: string | undefined = snap.data()?.passwordCurrent;
  const history: string[] = snap.data()?.passwordHistory ?? [];
  let reused = false;
  if (!current) {
    await ref.set({ passwordCurrent: hashPassword(password), passwordHistory: [] }, { merge: true });
  } else if (!matchesHash(password, current)) {
    reused = history.some((h) => matchesHash(password, h));
    await ref.set(
      {
        passwordCurrent: hashPassword(password),
        passwordHistory: [current, ...history].slice(0, PASSWORD_HISTORY),
      },
      { merge: true },
    );
  }
  if (reused) return '前に使ったパスワードに戻されています。新しいパスワードに変えてください';
  const weak = passwordProblem(password);
  return weak ? `今のパスワードはポリシーを満たしていません（${weak}）。変えてください` : null;
}

export async function login(input: LoginInput, client: Client): Promise<LoginResult> {
  const guardRef = db.doc(`${base(input.companyId)}/loginGuards/${emailKey(input.email)}`);
  const guardSnap = await guardRef.get();
  const now = Date.now();
  const guard: LoginGuard | null = guardSnap.exists
    ? {
        failures: guardSnap.data()!.failures ?? 0,
        lockedUntil: (guardSnap.data()!.lockedUntil as Timestamp | null)?.toMillis() ?? null,
      }
    : null;

  if (isLocked(guard, now)) {
    await audit(input.companyId, 'loginLocked', { uid: null }, client, { email: input.email });
    const until = new Date(guard!.lockedUntil!).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' });
    throw new HttpsError('resource-exhausted', `ログインに続けて失敗したため、${until}までロックしています。急ぐときは管理者に解除を頼んでください`);
  }

  const check = await checkPassword(input.email, input.password);
  if (!check.ok) {
    if (check.reason === 'disabled') throw new HttpsError('permission-denied', 'このアカウントは使えません');
    if (check.reason === 'throttled') throw new HttpsError('resource-exhausted', 'しばらくたってからログインしてください');
    const next = afterFailure(guard, now);
    await guardRef.set({
      email: input.email.toLowerCase(),
      failures: next.failures,
      lockedUntil: next.lockedUntil ? Timestamp.fromMillis(next.lockedUntil) : null,
      updatedAt: Timestamp.now(),
    });
    await audit(input.companyId, next.lockedUntil ? 'loginLockedNow' : 'loginFailed', { uid: null }, client, { email: input.email, failures: next.failures });
    if (next.lockedUntil) {
      throw new HttpsError('resource-exhausted', `${MAX_FAILURES}回続けて失敗したため、${LOCK_MINUTES}分ロックしました。急ぐときは管理者に解除を頼んでください`);
    }
    throw new HttpsError('unauthenticated', `メールアドレスまたはパスワードが違います（あと${MAX_FAILURES - next.failures}回でロックします）`);
  }

  const user = await loadUser(input.companyId, check.uid);
  if (!user || loginBlocked(user)) {
    await audit(input.companyId, 'loginRejected', { uid: check.uid }, client, { email: input.email, reason: user ? 'loginDisabled' : 'notUser' });
    throw new HttpsError('permission-denied', user ? 'ログインが停止されています' : 'このシステムの利用者として登録されていません。招待を受けてください');
  }
  if (guardSnap.exists) await guardRef.delete();
  const mustChange = await trackPassword(input.companyId, check.uid, input.password);
  const result = await startSession(input.companyId, check.uid, 'password', client, mustChange);
  await audit(input.companyId, 'login', { uid: check.uid, name: user.displayName }, client, { method: 'password', sessionId: result.sessionId });
  return result;
}

/** Google でログインした人が、会社の許可ドメインに入っていて、利用者として登録されているか */
export async function googleLogin(input: GoogleLoginInput, client: Client): Promise<LoginResult> {
  const decoded = await getAuth().verifyIdToken(input.idToken).catch(() => null);
  if (!decoded || decoded.firebase?.sign_in_provider !== 'google.com' || !decoded.email) {
    throw new HttpsError('unauthenticated', 'Google でのログインを確かめられませんでした');
  }
  const company = await db.doc(base(input.companyId)).get();
  if (!domainAllowed(decoded.email, company.data()?.allowedGoogleDomains)) {
    await audit(input.companyId, 'loginRejected', { uid: decoded.uid }, client, { email: decoded.email, reason: 'domain' });
    throw new HttpsError('permission-denied', 'このメールアドレスのドメインでは Google ログインが許可されていません');
  }
  const user = await loadUser(input.companyId, decoded.uid);
  if (!user || loginBlocked(user)) {
    await audit(input.companyId, 'loginRejected', { uid: decoded.uid }, client, { email: decoded.email, reason: user ? 'loginDisabled' : 'notUser' });
    throw new HttpsError('permission-denied', user ? 'ログインが停止されています' : 'このシステムの利用者として登録されていません。招待を受けてください');
  }
  const result = await startSession(input.companyId, decoded.uid, 'google', client, null);
  await audit(input.companyId, 'login', { uid: decoded.uid, name: user.displayName }, client, { method: 'google', sessionId: result.sessionId });
  return result;
}

export async function logout(auth: AuthContext, sessionId: string, client: Client): Promise<{ success: boolean }> {
  await db.doc(`${base(auth.companyId)}/sessions/${sessionId}`).update({ revokedAt: Timestamp.now(), revokedReason: 'logout' });
  await audit(auth.companyId, 'logout', { uid: auth.uid }, client, { sessionId });
  return { success: true };
}

export interface SessionItem {
  id: string;
  method: string;
  ip: string;
  userAgent: string;
  createdAt: string;
  lastActiveAt: string;
  current: boolean;
}

/** 本人の、今使えるセッション（ログイン中の端末）の一覧。8時間を過ぎたものと、30分操作がなく切れたものは出さない */
export async function listSessions(auth: AuthContext, sessionId: string): Promise<{ items: SessionItem[] }> {
  const since = Timestamp.fromMillis(Date.now() - SESSION_HOURS * 60 * 60 * 1000);
  const activeSince = Date.now() - IDLE_MINUTES * 60 * 1000;
  const snap = await db.collection(`${base(auth.companyId)}/sessions`).where('uid', '==', auth.uid).get();
  const items = snap.docs
    .filter((d) => !d.data().revokedAt && (d.data().createdAt as Timestamp).toMillis() >= since.toMillis())
    .filter((d) => d.id === sessionId || ((d.data().lastActiveAt as Timestamp | undefined)?.toMillis() ?? 0) >= activeSince)
    .map((d) => ({
      id: d.id,
      method: d.data().method,
      ip: d.data().ip ?? '',
      userAgent: d.data().userAgent ?? '',
      createdAt: (d.data().createdAt as Timestamp).toDate().toISOString(),
      lastActiveAt: (d.data().lastActiveAt as Timestamp).toDate().toISOString(),
      current: d.id === sessionId,
    }))
    .sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
  return { items };
}

export async function revokeSession(auth: AuthContext, input: RevokeSessionInput, client: Client): Promise<{ success: boolean }> {
  const ref = db.doc(`${base(auth.companyId)}/sessions/${input.sessionId}`);
  const snap = await ref.get();
  if (!snap.exists || snap.data()!.uid !== auth.uid) throw new HttpsError('not-found', '端末が見つかりません');
  await ref.update({ revokedAt: Timestamp.now(), revokedReason: 'revokedByUser' });
  await audit(auth.companyId, 'sessionRevoke', { uid: auth.uid }, client, { sessionId: input.sessionId });
  return { success: true };
}

/** 管理者がロックを解く */
export async function unlock(auth: AuthContext, input: UnlockInput, client: Client): Promise<{ success: boolean; wasLocked: boolean }> {
  const ref = db.doc(`${base(auth.companyId)}/loginGuards/${emailKey(input.email)}`);
  const snap = await ref.get();
  if (snap.exists) await ref.delete();
  await audit(auth.companyId, 'loginUnlock', { uid: auth.uid }, client, { email: input.email });
  return { success: true, wasLocked: snap.exists };
}

export async function changePassword(auth: AuthContext, input: ChangePasswordInput, client: Client): Promise<{ success: boolean }> {
  const problem = passwordProblem(input.newPassword);
  if (problem) throw new HttpsError('invalid-argument', problem);
  const authUser = await getAuth().getUser(auth.uid);
  if (!authUser.email) throw new HttpsError('failed-precondition', 'メールアドレスのないアカウントです');
  const check = await checkPassword(authUser.email, input.currentPassword);
  if (!check.ok) throw new HttpsError('invalid-argument', '今のパスワードが違います');

  const ref = db.doc(`${base(auth.companyId)}/userSecrets/${auth.uid}`);
  const snap = await ref.get();
  const history: string[] = snap.data()?.passwordHistory ?? [];
  const used = [hashPassword(input.currentPassword), ...history];
  if (input.newPassword === input.currentPassword || history.some((h) => matchesHash(input.newPassword, h))) {
    throw new HttpsError('invalid-argument', `前に使ったパスワード（直近${PASSWORD_HISTORY}個）は使えません`);
  }
  await getAuth().updateUser(auth.uid, { password: input.newPassword });
  await ref.set(
    { passwordCurrent: hashPassword(input.newPassword), passwordHistory: used.slice(0, PASSWORD_HISTORY), passwordChangedAt: Timestamp.now() },
    { merge: true },
  );
  await audit(auth.companyId, 'passwordChange', { uid: auth.uid }, client);
  return { success: true };
}

async function loadInvitation(companyId: string, invitationId: string) {
  const ref = db.doc(`${base(companyId)}/invitations/${invitationId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', '招待が見つかりません。管理者に確かめてください');
  const inv = snap.data() as InvitationDoc;
  if (inv.status === 'accepted') throw new HttpsError('failed-precondition', 'この招待はもう使われています。ログイン画面からログインしてください');
  // 再発行・作り直しで無効にした招待（expired・reissued）
  if (inv.status !== 'pending') throw new HttpsError('failed-precondition', 'この招待のリンクは使えなくなりました。新しい招待のリンクを管理者に確かめてください');
  if ((inv.expiresAt as Timestamp).toMillis() < Date.now()) {
    throw new HttpsError('failed-precondition', '招待の期限（7日）が切れています。管理者に再発行を頼んでください');
  }
  return { ref, inv };
}

export async function invitationGet(input: InvitationGetInput): Promise<{ email: string; displayName: string; expiresAt: string; googleAllowed: boolean }> {
  const { inv } = await loadInvitation(input.companyId, input.invitationId);
  const company = await db.doc(base(input.companyId)).get();
  let displayName = inv.displayName ?? '';
  // 従業員の招待は台帳の氏名を入れておく
  if (!displayName && inv.employeeId) {
    const emp = (await db.doc(`${base(input.companyId)}/employees/${inv.employeeId}`).get()).data() as EmployeeDoc | undefined;
    if (emp) displayName = `${emp.lastName ?? ''} ${emp.firstName ?? ''}`.trim();
  }
  return {
    email: inv.email,
    displayName,
    expiresAt: (inv.expiresAt as Timestamp).toDate().toISOString(),
    googleAllowed: domainAllowed(inv.email, company.data()?.allowedGoogleDomains),
  };
}

/**
 * 従業員につなぐ招待を受けられるか。退職した人・ほかのアカウントにつながっている人は断る
 * （招待してから受け取るまでに退職したり、別の招待で先につながったりすることがある）
 */
export function employeeLinkProblem(employee: EmployeeDoc | undefined, uid: string | null): string | null {
  if (!employee || employee.deletedAt) return 'この招待の従業員が見つかりません。管理者に確かめてください';
  if (!employee.isActive || employee.resignationDate) return '退職した従業員の招待は受けられません。管理者に確かめてください';
  if (employee.userId && employee.userId !== uid) return 'この従業員はすでに別のアカウントにつながっています。管理者に確かめてください';
  return null;
}

/** 招待を受けて利用者になる。招待されたメールアドレスでだけ登録できる（招待のない登録はできない） */
export async function invitationAccept(input: InvitationAcceptInput, client: Client): Promise<LoginResult> {
  const { ref: invRef, inv } = await loadInvitation(input.companyId, input.invitationId);
  const employeeRef = inv.employeeId ? db.doc(`${base(input.companyId)}/employees/${inv.employeeId}`) : null;
  // アカウントを作る前にも確かめる（作ってから断ると、使えないアカウントが残る）
  if (employeeRef) {
    const problem = employeeLinkProblem((await employeeRef.get()).data() as EmployeeDoc | undefined, null);
    if (problem) throw new HttpsError('failed-precondition', problem);
  }
  let uid: string;
  let method: 'password' | 'google';
  if (input.idToken) {
    const decoded = await getAuth().verifyIdToken(input.idToken).catch(() => null);
    if (!decoded || decoded.firebase?.sign_in_provider !== 'google.com') throw new HttpsError('unauthenticated', 'Google でのログインを確かめられませんでした');
    if ((decoded.email ?? '').toLowerCase() !== inv.email.toLowerCase()) {
      throw new HttpsError('permission-denied', `招待されたメールアドレス（${inv.email}）の Google アカウントを選んでください`);
    }
    const company = await db.doc(base(input.companyId)).get();
    if (!domainAllowed(inv.email, company.data()?.allowedGoogleDomains)) throw new HttpsError('permission-denied', 'このドメインでは Google ログインが許可されていません');
    uid = decoded.uid;
    method = 'google';
  } else {
    const problem = passwordProblem(input.password!);
    if (problem) throw new HttpsError('invalid-argument', problem);
    // 同じ Firebase を使うほかのアプリですでにアカウントがあれば、そのパスワードで本人と確かめる
    const existing = await getAuth().getUserByEmail(inv.email).catch(() => null);
    if (existing) {
      const check = await checkPassword(inv.email, input.password!);
      if (!check.ok) throw new HttpsError('invalid-argument', 'このメールアドレスはすでにアカウントがあります。そのパスワードを入れてください');
      uid = existing.uid;
    } else {
      uid = (await getAuth().createUser({ email: inv.email, password: input.password!, displayName: input.displayName })).uid;
    }
    await db.doc(`${base(input.companyId)}/userSecrets/${uid}`).set({ passwordCurrent: hashPassword(input.password!), passwordHistory: [] }, { merge: true });
    method = 'password';
  }

  const now = Timestamp.now();
  const userRef = db.doc(`${base(input.companyId)}/users/${uid}`);
  await db.runTransaction(async (tx) => {
    const [invSnap, userSnap, employeeSnap] = await Promise.all([tx.get(invRef), tx.get(userRef), employeeRef ? tx.get(employeeRef) : null]);
    if (invSnap.data()?.status !== 'pending') throw new HttpsError('failed-precondition', 'この招待はもう使われています');
    if (userSnap.exists) throw new HttpsError('already-exists', 'このアカウントはすでに利用者として登録されています');
    if (employeeSnap) {
      const problem = employeeLinkProblem(employeeSnap.data() as EmployeeDoc | undefined, uid);
      if (problem) throw new HttpsError('failed-precondition', problem);
    }
    tx.set(userRef, {
      email: inv.email,
      displayName: input.displayName,
      roles: inv.roles,
      officeIds: inv.officeIds ?? [],
      employeeId: inv.employeeId ?? null,
      isSuspended: false,
      isLoginDisabled: false,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
    });
    tx.update(invRef, { status: 'accepted', acceptedAt: now, acceptedBy: uid, updatedAt: now });
    if (employeeRef) tx.update(employeeRef, { userId: uid, updatedAt: now });
  });
  await audit(input.companyId, 'invitationAccept', { uid, name: input.displayName }, client, { invitationId: input.invitationId, method });
  const result = await startSession(input.companyId, uid, method, client, null);
  await audit(input.companyId, 'login', { uid, name: input.displayName }, client, { method, sessionId: result.sessionId });
  return result;
}

/** 招待の再発行（期限切れ・使われていない招待を、新しい期限で出し直す） */
export async function invitationReissue(auth: AuthContext, invitationId: string, client: Client): Promise<{ success: boolean; id: string }> {
  const ref = db.doc(`${base(auth.companyId)}/invitations/${invitationId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', '招待が見つかりません');
  const inv = snap.data() as InvitationDoc;
  if (inv.status === 'accepted') throw new HttpsError('failed-precondition', 'この招待はもう使われています');
  const now = Timestamp.now();
  const next = db.collection(`${base(auth.companyId)}/invitations`).doc();
  const batch = db.batch();
  batch.set(next, {
    email: inv.email,
    roles: inv.roles,
    officeIds: inv.officeIds ?? [],
    employeeId: inv.employeeId ?? null,
    status: 'pending',
    invitedBy: auth.uid,
    reissuedFrom: invitationId,
    expiresAt: Timestamp.fromMillis(now.toMillis() + 7 * 24 * 60 * 60 * 1000),
    createdAt: now,
    updatedAt: now,
  });
  batch.update(ref, { status: 'reissued', updatedAt: now, reissuedTo: next.id });
  await batch.commit();
  await audit(auth.companyId, 'invitationReissue', { uid: auth.uid }, client, { from: invitationId, to: next.id, email: inv.email });
  return { success: true, id: next.id };
}
