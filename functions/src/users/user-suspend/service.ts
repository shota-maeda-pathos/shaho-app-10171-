import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext } from '../../middleware/auth';
import { UserDoc } from '../../types/firestore';
import { MutationResponse } from '../../types/response';
import { notFound, invalidArg } from '../../utils/errors';
import { UserSuspendInput, UserDisableLoginInput } from './schema';

export async function suspendUser(
  input: UserSuspendInput,
  auth: AuthContext,
): Promise<MutationResponse> {
  if (input.userId === auth.uid) {
    throw invalidArg('自分自身を停止することはできません');
  }

  const result = await db.runTransaction(async (tx) => {
    const userRef = db.doc(`companies/${auth.companyId}/users/${input.userId}`);
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) throw notFound('ユーザー');

    const userData = userSnap.data()! as UserDoc;
    if (userData.isSuspended) {
      throw invalidArg('このユーザーはすでに停止されています');
    }

    const now = Timestamp.now();
    tx.update(userRef, { isSuspended: true, updatedAt: now });

    const auditRef = db.collection(`companies/${auth.companyId}/auditLogs`).doc();
    tx.set(auditRef, {
      entity: 'user',
      entityId: input.userId,
      action: 'suspend',
      changes: { isSuspended: { from: false, to: true } },
      performedBy: auth.uid,
      performedAt: now,
      version: 1,
    });

    return input.userId;
  });

  return { success: true, id: result };
}

export async function unsuspendUser(
  input: UserSuspendInput,
  auth: AuthContext,
): Promise<MutationResponse> {
  const result = await db.runTransaction(async (tx) => {
    const userRef = db.doc(`companies/${auth.companyId}/users/${input.userId}`);
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) throw notFound('ユーザー');

    const userData = userSnap.data()! as UserDoc;
    if (!userData.isSuspended && !userData.suspendFrom) {
      throw invalidArg('このユーザーは停止されていません');
    }

    // 退職による予定の停止も取り消す（再入社など）
    const now = Timestamp.now();
    tx.update(userRef, { isSuspended: false, suspendFrom: null, loginDisabledFrom: null, updatedAt: now });

    const auditRef = db.collection(`companies/${auth.companyId}/auditLogs`).doc();
    tx.set(auditRef, {
      entity: 'user',
      entityId: input.userId,
      action: 'unsuspend',
      changes: { isSuspended: { from: true, to: false } },
      performedBy: auth.uid,
      performedAt: now,
      version: 1,
    });

    return input.userId;
  });

  return { success: true, id: result };
}

export async function disableUserLogin(
  input: UserDisableLoginInput,
  auth: AuthContext,
): Promise<MutationResponse> {
  if (input.userId === auth.uid) {
    throw invalidArg('自分自身のログインを無効化することはできません');
  }

  const result = await db.runTransaction(async (tx) => {
    const userRef = db.doc(`companies/${auth.companyId}/users/${input.userId}`);
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) throw notFound('ユーザー');

    const userData = userSnap.data()! as UserDoc;
    if (userData.isLoginDisabled) {
      throw invalidArg('このユーザーのログインはすでに無効化されています');
    }

    const now = Timestamp.now();
    tx.update(userRef, { isLoginDisabled: true, updatedAt: now });

    const auditRef = db.collection(`companies/${auth.companyId}/auditLogs`).doc();
    tx.set(auditRef, {
      entity: 'user',
      entityId: input.userId,
      action: 'disableLogin',
      changes: { isLoginDisabled: { from: false, to: true } },
      performedBy: auth.uid,
      performedAt: now,
      version: 1,
    });

    return input.userId;
  });

  return { success: true, id: result };
}
