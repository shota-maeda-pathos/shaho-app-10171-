import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext } from '../../middleware/auth';
import { MutationResponse } from '../../types/response';
import { notFound } from '../../utils/errors';
import { DependentDeleteInput } from './schema';

export async function deleteDependent(
  input: DependentDeleteInput,
  auth: AuthContext,
): Promise<MutationResponse> {
  const docRef = db.doc(
    `companies/${auth.companyId}/employees/${input.employeeId}/dependents/${input.dependentId}`,
  );

  await db.runTransaction(async (tx) => {
    const doc = await tx.get(docRef);
    if (!doc.exists || doc.data()!.deletedAt !== null) {
      throw notFound('扶養家族');
    }

    const now = Timestamp.now();
    tx.update(docRef, {
      deletedAt: now,
      updatedAt: now,
    });

    const auditRef = db
      .collection(`companies/${auth.companyId}/auditLogs`)
      .doc();
    tx.set(auditRef, {
      entity: 'dependent',
      entityId: input.dependentId,
      action: 'delete',
      changes: { deletedAt: { from: null, to: now } },
      performedBy: auth.uid,
      performedAt: now,
      version: 1,
    });
  });

  return { success: true, id: input.dependentId };
}
