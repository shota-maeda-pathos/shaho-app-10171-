import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { EmployeeDoc, ApprovalRequestDoc } from '../../types/firestore';
import { MutationResponse } from '../../types/response';
import { notFound, invalidArg } from '../../utils/errors';
import { ApprovalRequestApproveInput } from './schema';
import { validateApprovalTarget } from '../target';
import { filingContentHash } from '../../utils/hash';
import { buildArchive } from '../../filings/archive/rules';
import { procedureLinkForRequest } from '../procedure-link';

export async function approveApprovalRequest(
  input: ApprovalRequestApproveInput,
  auth: AuthContext,
  options: { notify?: boolean } = {},
): Promise<MutationResponse> {
  const empRef = db.doc(
    `companies/${auth.companyId}/employees/${input.employeeId}`,
  );

  let requestType = '';
  let targetPath = '';
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
    requestType = reqData.requestType;
    targetPath = reqData.targetPath;
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

    // 入社手続きの資格取得届は、承認と同時に資格取得時決定の等級を確定する（等級はサーバーが申請時に計算したもの）
    const filingGrade = reqData.requestType === 'filing' ? (reqData.metadata?.grade as Record<string, unknown> | undefined) : undefined;
    let filingGradeRef: FirebaseFirestore.DocumentReference | null = null;
    if (filingGrade) {
      const path = String(filingGrade.path ?? '');
      validateApprovalTarget(path, 'grade', auth.companyId, input.employeeId);
      filingGradeRef = db.doc(path);
      const existing = await tx.get(filingGradeRef);
      if (existing.exists && existing.data()!.isConfirmed === true) throw invalidArg('この月の等級は既に確定しています');
    }

    // 届出の保存原本に残す事業所・会社の情報（承認時点の値）。トランザクションの書き込みより前に読む。
    // 事業所は届出の事業所（異動の取得届は、所属を変える前に異動先の事業所で出す）
    const archiveOfficeId = (targetData.officeId as string | undefined) || employee.officeId;
    const [archiveCompany, archiveOffice] = reqData.requestType === 'filing'
      ? await Promise.all([tx.get(db.doc(`companies/${auth.companyId}`)), tx.get(db.doc(`companies/${auth.companyId}/offices/${archiveOfficeId}`))])
      : [null, null];

    const now = Timestamp.now();

    tx.update(reqRef, {
      status: 'approved',
      reviewedBy: auth.uid,
      reviewedAt: now,
      approvedHash: reqData.requestType === 'filing' ? filingContentHash(targetData) : null,
      comment: input.comment ?? reqData.comment,
      updatedAt: now,
    });

    if (reqData.requestType === 'grade' && reqData.metadata) {
      const meta = reqData.metadata as Record<string, unknown>;
      // 等級の文書IDは承認対象パス（定時決定は適用開始月）。同じ申請の再承認で二重に作らない
      const gradeRef = db.doc(reqData.targetPath);
      tx.set(gradeRef, {
        effectiveMonth: meta.effectiveMonth,
        determinationType: meta.determinationType ?? 'regular',
        healthGradeNumber: meta.healthGradeNumber,
        healthStandardRemuneration: meta.healthStandardRemuneration,
        pensionGradeNumber: meta.pensionGradeNumber,
        pensionStandardRemuneration: meta.pensionStandardRemuneration,
        reason: meta.reason ?? '',
        basisRemuneration: meta.basisRemuneration ?? null,
        basisMonths: meta.basisMonths ?? null,
        approvalRequestId: reqRef.id,
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
        // 承認した内容の指紋。送信・提出のときに照らし合わせ、承認後の書き換えを見つける
        approvedHash: filingContentHash(targetData),
        version: targetData.version + 1,
        updatedAt: now,
      });
      // 保存原本：承認時点の記入内容と様式の版。追記するだけで消さない
      tx.set(targetRef.collection('archives').doc(), {
        ...buildArchive({ source: 'employee', data: targetData, approvedBy: auth.uid, approvalRequestId: reqRef.id,
          company: archiveCompany?.data() ?? null, office: archiveOffice?.data() ?? null, employee }),
        approvedAt: now,
      });
      if (filingGrade && filingGradeRef) {
        tx.set(filingGradeRef, {
          effectiveMonth: filingGrade.effectiveMonth,
          determinationType: filingGrade.determinationType ?? 'initial',
          healthGradeNumber: filingGrade.healthGradeNumber,
          healthStandardRemuneration: filingGrade.healthStandardRemuneration,
          pensionGradeNumber: filingGrade.pensionGradeNumber,
          pensionStandardRemuneration: filingGrade.pensionStandardRemuneration,
          reason: filingGrade.reason ?? '',
          basisRemuneration: filingGrade.basisRemuneration ?? null,
          basisMonths: Array.isArray(filingGrade.basisMonths) ? filingGrade.basisMonths : null,
          // 等級の履歴から、決めたときの届出をたどれるようにする
          filingId: targetRef.id,
          approvalRequestId: reqRef.id,
          isConfirmed: true,
          confirmedAt: now,
          confirmedBy: auth.uid,
          version: 1,
          createdAt: now,
          updatedAt: now,
        });
      }
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
      employeeId: input.employeeId,
      action: 'approve',
      changes: { status: { from: 'pending', to: 'approved' } },
      performedBy: auth.uid,
      performedAt: now,
      version: 1,
    });

    return input.requestId;
  });

  // 訂正した保険料が承認し直されたら、本人に訂正があった旨を知らせる（まとめての承認でも出す）
  if (requestType === 'monthlyInsurance') {
    const { notifyCorrectedPremium } = await import('../../utils/notify-employee');
    await notifyCorrectedPremium(auth.companyId, input.employeeId, targetPath);
  }
  // 毎月の処理でまとめて承認するときは、1人ずつの手続きの更新と通知を出さない（給与・保険料は手続きに関わらない）
  if (options.notify === false) return { success: true, id: result };
  const { refreshEmployeeProcedures } = await import('../../procedures/hooks');
  await refreshEmployeeProcedures(auth.companyId, input.employeeId);

  const { notify } = await import('../../utils/notify');
  const { employeeNoticeContext, REQUEST_TYPE_LABELS } = await import('../../utils/notice-context');
  const who = await employeeNoticeContext(auth.companyId, input.employeeId);
  // 押すと依頼を出した手続きの画面が開く（担当者が直す・提出するのはそこ）。見つからなければ種類から決める（承認の画面）
  const link = await procedureLinkForRequest(auth.companyId, input.employeeId, input.requestId);
  await notify({
    companyId: auth.companyId,
    officeId: who.officeId,
    link,
    title: '承認されました',
    body: `${who.name}さんの${REQUEST_TYPE_LABELS[requestType] ?? requestType}が承認されました`,
    category: 'approval',
    targetType: 'approvalRequest',
    targetId: result,
    createdBy: auth.uid,
  });

  return { success: true, id: result };
}
