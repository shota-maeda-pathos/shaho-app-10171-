import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { EmployeeDoc, ApprovalRequestDoc } from '../../types/firestore';
import { MutationResponse } from '../../types/response';
import { notFound, invalidArg } from '../../utils/errors';
import { ApprovalRequestApproveInput } from './schema';
import { validateApprovalTarget } from '../target';

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

    if (reqData.requestedBy === auth.uid) {
      throw invalidArg('自分が作成した承認リクエストを自分で承認することはできません');
    }

    validateApprovalTarget(reqData.targetPath,reqData.requestType,auth.companyId,input.employeeId);
    const targetRef = db.doc(reqData.targetPath);
    const isDeferred = reqData.requestType === 'grade' && reqData.targetVersion === 0;
    let targetData: FirebaseFirestore.DocumentData = {};

    if (!isDeferred) {
      const targetSnap = await tx.get(targetRef);
      if (!targetSnap.exists) {
        throw notFound('承認対象ドキュメント');
      }
      targetData = targetSnap.data()!;
    }
    if (!isDeferred) {
      if (reqData.requestType === 'bonusInsurance') {
          const source = await tx.get(db.doc(`companies/${auth.companyId}/employees/${input.employeeId}/bonuses/${targetRef.id}`));
          if (!source.exists || source.data()!.isConfirmed !== true || source.data()!.version !== targetData.bonusVersion) throw invalidArg('承認済み賞与が変更されています。再計算してください');
      }
      if (targetData.version !== reqData.targetVersion) {
        throw invalidArg(
          `承認対象が変更されています（承認リクエスト時: v${reqData.targetVersion}, 現行: v${targetData.version}）`,
        );
      }
    }

    const now = Timestamp.now();

    tx.update(reqRef, {
      status: 'approved',
      reviewedBy: auth.uid,
      reviewedAt: now,
      comment: input.comment ?? reqData.comment,
      updatedAt: now,
    });

    if (reqData.requestType === 'grade' && reqData.metadata) {
      const meta = reqData.metadata as Record<string, unknown>;
      const gradeRef = db.collection(
        `companies/${auth.companyId}/employees/${input.employeeId}/grades`,
      ).doc();
      tx.set(gradeRef, {
        effectiveMonth: meta.effectiveMonth,
        determinationType: meta.determinationType ?? 'regular',
        healthGradeNumber: meta.healthGradeNumber,
        healthStandardRemuneration: meta.healthStandardRemuneration,
        pensionGradeNumber: meta.pensionGradeNumber,
        pensionStandardRemuneration: meta.pensionStandardRemuneration,
        reason: meta.reason ?? '',
        isConfirmed: true,
        confirmedAt: now,
        confirmedBy: auth.uid,
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
    } else if (reqData.requestType === 'filing') {
      tx.update(targetRef, {
        workflowStatus: 'approved',
        version: targetData.version + 1,
        updatedAt: now,
      });
    } else {
      tx.update(targetRef, {
        isConfirmed: true,
        ...(['salary','monthlyInsurance', 'bonus', 'bonusInsurance'].includes(reqData.requestType) ? { approvalPending: false } : {}),
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

  const { refreshEmployeeProcedures } = await import('../../procedures/hooks');
  await refreshEmployeeProcedures(auth.companyId, input.employeeId);

  const { notify } = await import('../../utils/notify');
  await notify({
    companyId: auth.companyId,
    title: '承認完了',
    body: '承認依頼が承認されました',
    category: 'approval',
    targetType: 'approvalRequest',
    targetId: result,
    createdBy: auth.uid,
  });

  return { success: true, id: result };
}
