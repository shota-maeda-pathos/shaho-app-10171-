import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { EmployeeDoc } from '../../types/firestore';
import { MutationResponse } from '../../types/response';
import { notFound, invalidArg } from '../../utils/errors';
import { ApprovalRequestCreateInput } from './schema';

export async function createApprovalRequest(
  input: ApprovalRequestCreateInput,
  auth: AuthContext,
): Promise<MutationResponse> {
  const empRef = db.doc(
    `companies/${auth.companyId}/employees/${input.employeeId}`,
  );

  const result = await db.runTransaction(async (tx) => {
    const empSnap = await tx.get(empRef);
    if (!empSnap.exists || empSnap.data()!.deletedAt !== null) {
      throw notFound('従業員');
    }
    const employee = empSnap.data()! as EmployeeDoc;

    if (!auth.roles.includes('admin')) {
      requireOffice(auth, employee.officeId);
    }

    const targetRef = db.doc(input.targetPath);
    const targetSnap = await tx.get(targetRef);
    if (!targetSnap.exists) {
      throw notFound('承認対象ドキュメント');
    }

    const targetData = targetSnap.data()!;
    if (targetData.version !== input.targetVersion) {
      throw invalidArg(
        `承認対象の版番号が一致しません（現行: ${targetData.version}, 指定: ${input.targetVersion}）`,
      );
    }

    const now = Timestamp.now();
    const reqRef = db
      .collection(
        `companies/${auth.companyId}/employees/${input.employeeId}/approvalRequests`,
      )
      .doc();

    tx.set(reqRef, {
      targetPath: input.targetPath,
      targetVersion: input.targetVersion,
      snapshotData: targetData,
      requestType: input.requestType,
      status: 'pending',
      requestedBy: auth.uid,
      requestedAt: now,
      reviewedBy: null,
      reviewedAt: null,
      comment: input.comment ?? null,
      createdAt: now,
      updatedAt: now,
    });

    const auditRef = db
      .collection(`companies/${auth.companyId}/auditLogs`)
      .doc();
    tx.set(auditRef, {
      entity: 'approvalRequest',
      entityId: reqRef.id,
      action: 'create',
      changes: {},
      performedBy: auth.uid,
      performedAt: now,
      version: 1,
    });

    return reqRef.id;
  });

  return { success: true, id: result };
}
