import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';

export type Role = 'admin' | 'operator' | 'approver' | 'viewer' | 'employee';

export interface AuthContext {
  uid: string;
  companyId: string;
  roles: Role[];
  officeIds: string[];
  employeeId?: string | null;
  isSuspended: boolean;
  isLoginDisabled: boolean;
}

export async function getAuthContext(
  request: CallableRequest,
  companyId: string,
): Promise<AuthContext> {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', '認証が必要です');
  }
  const uid = request.auth.uid;
  const userDoc = await getFirestore()
    .doc(`companies/${companyId}/users/${uid}`)
    .get();
  if (!userDoc.exists) {
    throw new HttpsError('permission-denied', 'この会社へのアクセス権がありません');
  }
  const data = userDoc.data()!;
  return {
    uid,
    companyId,
    roles: data.roles ?? [],
    officeIds: data.officeIds ?? [],
    employeeId: typeof data.employeeId === 'string' ? data.employeeId : null,
    isSuspended: data.isSuspended ?? false,
    isLoginDisabled: data.isLoginDisabled ?? false,
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
