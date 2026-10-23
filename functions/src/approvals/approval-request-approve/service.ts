import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { EmployeeDoc, ApprovalRequestDoc } from '../../types/firestore';
import { MutationResponse } from '../../types/response';
import { notFound, invalidArg } from '../../utils/errors';
import { ApprovalRequestApproveInput } from './schema';

export async function approveApprovalRequest(
  input: ApprovalRequestApproveInput,
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

    const reqRef = db.doc(
      `companies/${auth.companyId}/employees/${input.employeeId}/approvalRequests/${input.requestId}`,
    );
    const reqSnap = await tx.get(reqRef);
    if (!reqSnap.exists) {
      throw notFound('承認リクエスト');
    }

    const reqData = reqSnap.data()! as ApprovalRequestDoc;
    if (reqData.status !== 'pending') {
      throw invalidArg(`この承認リクエストは既に処理済みです（状態: ${reqData.status}）`);
    }

    const targetRef = db.doc(reqData.targetPath);
    const targetSnap = await tx.get(targetRef);
    if (!targetSnap.exists) {
      throw notFound('承認対象ドキュメント');
    }

    const targetData = targetSnap.data()!;
    if (targetData.version !== reqData.targetVersion) {
      throw invalidArg(
        `承認対象が変更されています（承認リクエスト時: v${reqData.targetVersion}, 現行: v${targetData.version}）`,
      );
    }

    const now = Timestamp.now();

    tx.update(reqRef, {
      status: 'approved',
      reviewedBy: auth.uid,
      reviewedAt: now,
      comment: input.comment ?? reqData.comment,
      updatedAt: now,
    });

    if (reqData.requestType === 'filing') {
      tx.update(targetRef, {
        workflowStatus: 'approved',
        version: targetData.version + 1,
        updatedAt: now,
      });
    } else {
      tx.update(targetRef, {
        isConfirmed: true,
        confirmedAt: now,
        confirmedBy: auth.uid,
        version: targetData.version + 1,
        updatedAt: now,
      });
    }

    const auditRef = db
      .collection(`companies/${auth.companyId}/auditLogs`)
      .doc();
    tx.set(auditRef, {
      entity: 'approvalRequest',
      entityId: input.requestId,
      action: 'approve',
      changes: { status: { from: 'pending', to: 'approved' } },
      performedBy: auth.uid,
      performedAt: now,
      version: 1,
    });

    return input.requestId;
  });

  return { success: true, id: result };
}
