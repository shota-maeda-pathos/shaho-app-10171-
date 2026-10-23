import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext } from '../../middleware/auth';
import { UserDoc } from '../../types/firestore';
import { MutationResponse } from '../../types/response';
import { notFound, invalidArg } from '../../utils/errors';
import { UserUpdateRoleInput } from './schema';

export async function updateUserRole(
  input: UserUpdateRoleInput,
  auth: AuthContext,
): Promise<MutationResponse> {
  if (input.userId === auth.uid) {
    throw invalidArg('自分自身のロールは変更できません');
  }

  const result = await db.runTransaction(async (tx) => {
    const userRef = db.doc(
      `companies/${auth.companyId}/users/${input.userId}`,
    );
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) {
      throw notFound('ユーザー');
    }

    const userData = userSnap.data()! as UserDoc;
    const now = Timestamp.now();

    const changes: Record<string, { from: unknown; to: unknown }> = {};
    if (JSON.stringify(userData.roles) !== JSON.stringify(input.roles)) {
      changes.roles = { from: userData.roles, to: input.roles };
    }
    if (input.officeIds !== undefined) {
      if (JSON.stringify(userData.officeIds) !== JSON.stringify(input.officeIds)) {
        changes.officeIds = { from: userData.officeIds, to: input.officeIds };
      }
    }

    const updateData: Record<string, unknown> = {
      roles: input.roles,
      updatedAt: now,
    };
    if (input.officeIds !== undefined) {
      updateData.officeIds = input.officeIds;
    }

    tx.update(userRef, updateData);

    const auditRef = db
      .collection(`companies/${auth.companyId}/auditLogs`)
      .doc();
    tx.set(auditRef, {
      entity: 'user',
      entityId: input.userId,
      action: 'update',
      changes,
      performedBy: auth.uid,
      performedAt: now,
      version: 1,
    });

    return input.userId;
  });

  return { success: true, id: result };
}
