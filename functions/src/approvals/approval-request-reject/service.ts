import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { EmployeeDoc, ApprovalRequestDoc } from '../../types/firestore';
import { MutationResponse } from '../../types/response';
import { notFound, invalidArg } from '../../utils/errors';
import { ApprovalRequestRejectInput } from './schema';
import { validateApprovalTarget } from '../target';
import { procedureLinkForRequest } from '../procedure-link';

export async function rejectApprovalRequest(
  input: ApprovalRequestRejectInput,
  auth: AuthContext,
): Promise<MutationResponse> {
  const empRef = db.doc(
    `companies/${auth.companyId}/employees/${input.employeeId}`,
  );

  // 依頼した本人が承認待ちの依頼を取り下げたとき（承認の画面の「取り下げる」）。中身は差し戻しと同じで、手続きの画面から作り直せる
  let withdrawn = false;
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
    withdrawn = reqData.requestedBy === auth.uid;

    validateApprovalTarget(reqData.targetPath,reqData.requestType,auth.companyId,input.employeeId);
    if (['salary','monthlyInsurance', 'bonus', 'bonusInsurance'].includes(reqData.requestType)) {
      const targetRef = db.doc(reqData.targetPath);
      const target = await tx.get(targetRef);
      if (!target.exists || target.data()!.version !== reqData.targetVersion) throw invalidArg('承認対象が変更されています');
      // 差し戻しの理由を対象にも残し、毎月の処理などの一覧で「差し戻し」と理由を出せるようにする
      tx.update(targetRef, {
        approvalPending: false, version: target.data()!.version + 1, updatedAt: Timestamp.now(),
        lastRejection: { comment: input.comment ?? '', by: auth.uid, at: Timestamp.now() },
      });
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

  const { refreshEmployeeProcedures } = await import('../../procedures/hooks');
  await refreshEmployeeProcedures(auth.companyId, input.employeeId);

  const { notify } = await import('../../utils/notify');
  const { employeeNoticeContext } = await import('../../utils/notice-context');
  const who = await employeeNoticeContext(auth.companyId, input.employeeId);
  // 押すと依頼を出した手続きの画面が開く（担当者が直す・提出するのはそこ）。見つからなければ種類から決める（承認の画面）
  const link = await procedureLinkForRequest(auth.companyId, input.employeeId, input.requestId);
  await notify({
    companyId: auth.companyId,
    officeId: who.officeId,
    link,
    title: withdrawn ? '依頼を取り下げました' : '差し戻されました',
    body: `${who.name}さんの承認の依頼が${withdrawn ? '依頼した人により取り下げられました' : '差し戻されました'}。理由：${input.comment}`,
    category: 'approval',
    targetType: 'approvalRequest',
    targetId: result,
    createdBy: auth.uid,
  });

  return { success: true, id: result };
}
