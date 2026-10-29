import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { EmployeeDoc } from '../../types/firestore';
import { MutationResponse } from '../../types/response';
import { notFound, invalidArg } from '../../utils/errors';
import { ApprovalRequestCreateInput } from './schema';
import { validateApprovalTarget } from '../target';

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

    const locked = ['salary','monthlyInsurance', 'bonus', 'bonusInsurance'].includes(input.requestType);
    validateApprovalTarget(input.targetPath,input.requestType,auth.companyId,input.employeeId);
    const targetRef = db.doc(input.targetPath);
    const isDeferred = input.requestType === 'grade' && input.targetVersion === 0;
    let targetData: FirebaseFirestore.DocumentData | null = null;

    if (!isDeferred) {
      const targetSnap = await tx.get(targetRef);
      if (!targetSnap.exists) {
        throw notFound('承認対象ドキュメント');
      }
      targetData = targetSnap.data()!;
      if (input.requestType === 'bonusInsurance') {
        const source = await tx.get(db.doc(`companies/${auth.companyId}/employees/${input.employeeId}/bonuses/${targetRef.id}`));
        if (!source.exists || source.data()!.isConfirmed !== true || source.data()!.version !== targetData.bonusVersion) throw invalidArg('承認済み賞与の内容を確認して再計算してください');
      }
      if (targetData.version !== input.targetVersion) {
        throw invalidArg(
          `承認対象の版番号が一致しません（現行: ${targetData.version}, 指定: ${input.targetVersion}）`,
        );
      }
    }

    const requests = db.collection(`companies/${auth.companyId}/employees/${input.employeeId}/approvalRequests`);
    const reqRef = locked ? requests.doc(`${input.requestType}-${targetRef.id}-v${input.targetVersion}`) : requests.doc();
    if (locked && targetData) {
      if (targetData.isConfirmed) throw invalidArg('承認済みの対象です');
      const previous = await tx.get(reqRef);
      if (previous.exists && previous.data()!.status === 'pending') return reqRef.id;
      if (targetData.approvalPending) throw invalidArg('既に承認申請中です');
      if (previous.exists) throw invalidArg('再計算してから再申請してください');
    }
    const now = Timestamp.now();
    if (locked) tx.update(targetRef, { approvalPending: true, updatedAt: now });

    tx.set(reqRef, {
      targetPath: input.targetPath,
      targetVersion: input.targetVersion,
      snapshotData: targetData ?? {},
      requestType: input.requestType,
      status: 'pending',
      requestedBy: auth.uid,
      requestedAt: now,
      reviewedBy: null,
      reviewedAt: null,
      comment: input.comment ?? null,
      metadata: input.metadata ?? null,
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

  if (input.requestType === 'filing') {
    const filingId = input.targetPath.split('/').pop();
    if (filingId) {
      const { linkApprovalToProcedure } = await import('../../procedures/hooks');
      await linkApprovalToProcedure({
        companyId: auth.companyId,
        employeeId: input.employeeId,
        filingId,
        approvalRequestId: result,
      });
    }
  }

  const { notify } = await import('../../utils/notify');
  await notify({
    companyId: auth.companyId,
    title: '承認依頼',
    body: `${input.requestType}の承認依頼が作成されました`,
    category: 'approval',
    targetType: 'approvalRequest',
    targetId: result,
    createdBy: auth.uid,
  });

  return { success: true, id: result };
}
