import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { EmployeeDoc } from '../../types/firestore';
import { MutationResponse } from '../../types/response';
import { notFound } from '../../utils/errors';
import { toTimestamp } from '../../utils/firestore';
import { EmployeeTransferInput } from './schema';

export async function transferEmployee(
  input: EmployeeTransferInput,
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
      requireOffice(auth, input.newOfficeId);
    }

    if (current.officeId === input.newOfficeId) {
      throw new HttpsError(
        'invalid-argument',
        '異動先は現在の事業所と異なる必要があります',
      );
    }

    const now = Timestamp.now();
    const oldOfficeId = current.officeId;

    tx.update(docRef, {
      officeId: input.newOfficeId,
      updatedAt: now,
      version: current.version + 1,
    });

    const historyRef = db
      .collection(
        `companies/${auth.companyId}/employees/${input.employeeId}/transferHistory`,
      )
      .doc();
    tx.set(historyRef, {
      fromOfficeId: oldOfficeId,
      toOfficeId: input.newOfficeId,
      transferDate: toTimestamp(input.transferDate),
      reason: input.reason ?? null,
      performedBy: auth.uid,
      createdAt: now,
    });

    const auditRef = db
      .collection(`companies/${auth.companyId}/auditLogs`)
      .doc();
    tx.set(auditRef, {
      entity: 'employee',
      entityId: input.employeeId,
      action: 'transfer',
      changes: {
        officeId: { from: oldOfficeId, to: input.newOfficeId },
      },
      performedBy: auth.uid,
      performedAt: now,
      version: current.version + 1,
    });
  });

  return { success: true, id: input.employeeId };
}
