import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { EmployeeDoc, ApprovalRequestDoc } from '../../types/firestore';
import { MutationResponse } from '../../types/response';
import { notFound, invalidArg } from '../../utils/errors';
import { ApprovalRequestRejectInput } from './schema';

export async function rejectApprovalRequest(
  input: ApprovalRequestRejectInput,
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

    if (['monthlyInsurance', 'bonus', 'bonusInsurance'].includes(reqData.requestType)) {
      if (reqData.requestType !== 'monthlyInsurance') {
        const collection = reqData.requestType === 'bonus' ? 'bonuses' : 'bonusInsurance';
        const prefix = `companies/${auth.companyId}/employees/${input.employeeId}/${collection}/`;
        if (!reqData.targetPath.startsWith(prefix) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(reqData.targetPath.slice(prefix.length))) throw invalidArg('承認対象パスが不正です');
      }
      const targetRef = db.doc(reqData.targetPath);
      const target = await tx.get(targetRef);
      if (!target.exists || target.data()!.version !== reqData.targetVersion) throw invalidArg('承認対象が変更されています');
      tx.update(targetRef, { approvalPending: false, version: target.data()!.version + 1, updatedAt: Timestamp.now() });
    }
    if (reqData.requestType === 'filing') {
      const targetRef = db.doc(reqData.targetPath);
      const targetSnap = await tx.get(targetRef);
      if (targetSnap.exists) {
        const now = Timestamp.now();
        tx.update(targetRef, {
          workflowStatus: 'rejected',
          updatedAt: now,
        });
      }
    }

    const now = Timestamp.now();

    tx.update(reqRef, {
      status: 'rejected',
      reviewedBy: auth.uid,
      reviewedAt: now,
      comment: input.comment,
      updatedAt: now,
    });

    const auditRef = db
      .collection(`companies/${auth.companyId}/auditLogs`)
      .doc();
    tx.set(auditRef, {
      entity: 'approvalRequest',
      entityId: input.requestId,
      action: 'reject',
      changes: { status: { from: 'pending', to: 'rejected' } },
      performedBy: auth.uid,
      performedAt: now,
      version: 1,
    });

    return input.requestId;
  });

  const { notify } = await import('../../utils/notify');
  await notify({
    companyId: auth.companyId,
    title: '承認却下',
    body: `承認依頼が却下されました`,
    category: 'approval',
    targetType: 'approvalRequest',
    targetId: result,
    createdBy: auth.uid,
  });

  return { success: true, id: result };
}
