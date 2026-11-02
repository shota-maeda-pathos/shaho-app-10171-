import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../../config';
import { AuthContext } from '../../middleware/auth';
import { requireProcedureAccess } from '../access';
import { notFound, invalidArg } from '../../utils/errors';
import { ProcedureDoc } from '../../types/firestore';
import { MutationResponse } from '../../types/response';
import { notify } from '../../utils/notify';
import { ProcedureCancelInput } from './schema';
import { cancelPermissionProblem, CancelFiling, filingCancelPlan, procedureFilingIds } from './rules';

/**
 * 手続きをやめる（消さずに「取消」にする）。担当者は自分が始めた手続きだけ、管理者はだれの手続きでも（理由つき）。
 * 承認を頼んでいる最中・承認済み・提出済みの届出があればやめられない。下書きの届出は一緒に取り下げる
 */
export async function cancelProcedure(
  input: ProcedureCancelInput,
  auth: AuthContext,
): Promise<MutationResponse> {
  const base = `companies/${auth.companyId}`;
  const ref = db.doc(`${base}/procedures/${input.procedureId}`);

  const first = await ref.get();
  if (!first.exists) throw notFound('手続き');
  const before = first.data() as ProcedureDoc;
  const [creator, me] = await Promise.all([
    before.createdBy ? db.doc(`${base}/users/${before.createdBy}`).get() : null,
    db.doc(`${base}/users/${auth.uid}`).get(),
  ]);
  const creatorName = (creator?.data()?.displayName as string | undefined) ?? '始めた人';
  const myName = (me.data()?.displayName as string | undefined) ?? '管理者';
  const own = !!before.createdBy && before.createdBy === auth.uid;

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw notFound('手続き');

    const proc = snap.data()! as ProcedureDoc;
    if (proc.deletedAt !== null) throw notFound('手続き');

    requireProcedureAccess(auth, proc);
    const denied = cancelPermissionProblem({ roles: auth.roles, uid: auth.uid, createdBy: proc.createdBy, creatorName, reason: input.reason });
    if (denied) throw new HttpsError(own || auth.roles.includes('admin') ? 'invalid-argument' : 'permission-denied', denied);

    if (proc.version !== input.expectedVersion) {
      throw invalidArg('手続きが更新されています。画面を読み込み直してください');
    }
    if (proc.status === 'completed') throw invalidArg('完了した手続きはやめられません');
    if (proc.status === 'cancelled') throw invalidArg('この手続きはもう取り消してあります');
    // 入社は台帳に登録した時点で従業員ができているので、手続きだけやめると台帳が残る。従業員の画面で直してもらう
    if (proc.onboarding && proc.employeeId) throw invalidArg('台帳まで登録した入社の手続きはやめられません。従業員の画面から登録を直してください');

    // 承認を頼んでいる最中なら、やめる前に差し戻してもらう
    const approvalIds = proc.references.filter(r => r.type === 'approval' && r.documentId).map(r => ({ id: r.documentId, employeeId: r.employeeId ?? proc.employeeId }));
    const approvals = approvalIds.length
      ? await Promise.all(approvalIds.filter(a => a.employeeId).map(a => tx.get(db.doc(`${base}/employees/${a.employeeId}/approvalRequests/${a.id}`))))
      : [];
    if (approvals.some(a => a.exists && a.data()!.status === 'pending')) {
      throw invalidArg('承認を頼んでいる最中です。承認者に差し戻してもらってから、やめてください');
    }

    const filingIds = proc.employeeId ? procedureFilingIds(proc as unknown as ProcedureDoc & Record<string, unknown>) : [];
    const filingRefs = filingIds.map(id => db.doc(`${base}/employees/${proc.employeeId}/filings/${id}`));
    const filingSnaps = filingRefs.length ? await tx.getAll(...filingRefs) : [];
    const plan = filingCancelPlan(filingSnaps.filter(s => s.exists).map(s => ({ id: s.id, ...(s.data() as Omit<CancelFiling, 'id'>) })));
    if (plan.problem) throw invalidArg(plan.problem);

    const now = Timestamp.now();
    const reason = input.reason.trim() || 'やめた';
    tx.update(ref, {
      status: 'cancelled',
      statusReason: `取消: ${reason}`,
      cancelledAt: now,
      cancelledBy: auth.uid,
      updatedAt: now,
      version: proc.version + 1,
    });
    for (const id of plan.discard) {
      const s = filingSnaps.find(x => x.id === id)!;
      tx.update(s.ref, { discardedAt: now, workflowStatus: 'cancelled', cancelledAt: now, updatedAt: now, version: (s.data()!.version ?? 1) + 1 });
    }

    const auditRef = db.collection(`${base}/auditLogs`).doc();
    tx.set(auditRef, {
      entity: 'procedure',
      entityId: input.procedureId,
      action: 'update',
      changes: { status: { from: proc.status, to: 'cancelled' }, ...(plan.discard.length ? { discardedFilings: { from: null, to: plan.discard } } : {}) },
      note: reason,
      performedBy: auth.uid,
      performedAt: now,
      version: proc.version + 1,
    });

    return { title: proc.title, officeId: proc.officeId };
  });

  // ほかの人が始めた手続きを管理者がやめたときは、その事業所のスタッフに知らせる（始めた人が気づけるように）
  if (!own) {
    await notify({
      companyId: auth.companyId,
      officeId: result.officeId,
      title: '手続きが取り消されました',
      body: `${creatorName}さんが始めた「${result.title}」を、${myName}さんが取り消しました（理由：${input.reason.trim()}）`,
      category: 'system',
      targetType: 'procedure',
      targetId: input.procedureId,
      createdBy: auth.uid,
    });
  }

  return { success: true as const, id: input.procedureId };
}
