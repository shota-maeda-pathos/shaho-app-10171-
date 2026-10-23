import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { EmployeeDoc } from '../../types/firestore';
import { MutationResponse } from '../../types/response';
import { notFound } from '../../utils/errors';
import { EmployeeDeleteInput } from './schema';

export async function deleteEmployee(
  input: EmployeeDeleteInput,
  auth: AuthContext,
): Promise<MutationResponse> {
  const docRef = db.doc(
    `companies/${auth.companyId}/employees/${input.employeeId}`,
  );

  await db.runTransaction(async (tx) => {
    const doc = await tx.get(docRef);
    if (!doc.exists || doc.data()!.deletedAt !== null) {
      throw notFound('従業員');
    }
    const current = doc.data()! as EmployeeDoc;

    if (current.version !== input.expectedVersion) {
      throw new HttpsError(
        'failed-precondition',
        `データが更新されています（現在のバージョン: ${current.version}）`,
      );
    }

    if (!auth.roles.includes('admin')) {
      requireOffice(auth, current.officeId);
    }

    const now = Timestamp.now();
    tx.update(docRef, {
      deletedAt: now,
      updatedAt: now,
      version: current.version + 1,
    });

    const auditRef = db
      .collection(`companies/${auth.companyId}/auditLogs`)
      .doc();
    tx.set(auditRef, {
      entity: 'employee',
      entityId: input.employeeId,
      action: 'delete',
      changes: { deletedAt: { from: null, to: now } },
      performedBy: auth.uid,
      performedAt: now,
      version: current.version + 1,
    });
  });

  return { success: true, id: input.employeeId };
}
