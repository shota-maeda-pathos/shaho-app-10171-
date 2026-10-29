import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext } from '../../middleware/auth';
import { ProcedureDoc } from '../../types/firestore';
import { invalidArg, notFound } from '../../utils/errors';
import { requireProcedureAccess } from '../access';
import { refreshProcedure, resolveStepStatuses } from '../refresh';

export async function confirmProcedure(input: { procedureId: string; stepId: string; expectedVersion: number }, auth: AuthContext) {
  const ref = db.doc(`companies/${auth.companyId}/procedures/${input.procedureId}`);
  const initial = await ref.get();
  if (!initial.exists) throw notFound('手続き');
  const before = initial.data() as ProcedureDoc;
  requireProcedureAccess(auth, before);
  const previousStep = before.steps.find(s => s.id === input.stepId);
  if (before.status === 'completed' && previousStep?.type === 'confirmation' && previousStep.completedBy === auth.uid) return { success: true, id: input.procedureId };
  if (before.version !== input.expectedVersion) throw invalidArg('手続きが更新されています。再読み込みしてください');
  const { procedure } = await refreshProcedure(auth.companyId, input.procedureId);
  if (procedure.status === 'cancelled' || procedure.status === 'completed') throw invalidArg('この手続きは終了しています');
  const step = procedure.steps.find(s => s.id === input.stepId);
  if (step?.type !== 'confirmation' || step.status !== 'available') throw invalidArg('必要な作業が完了していないため、完了確認できません');
  const now = Timestamp.now();
  await db.runTransaction(async tx => {
    const latest = await tx.get(ref);
    if (!latest.exists) throw notFound('手続き');
    const current = latest.data() as ProcedureDoc;
    requireProcedureAccess(auth, current);
    if (current.version !== procedure.version || current.status !== procedure.status) throw invalidArg('手続きが更新されています。再読み込みしてください');
    const verified = await resolveStepStatuses(auth.companyId, current, path => tx.get(db.doc(path)));
    if (verified.find(s => s.id === input.stepId)?.status !== 'available') throw invalidArg('関連データが変更されています。作業状況を確認してください');
    const steps = verified.map(s => s.id === input.stepId ? { ...s, status: 'completed' as const, completedAt: now, completedBy: auth.uid, actionLabel: null, actionRoute: null } : s);
    const submitted = steps.some(s => ['mock_filing', 'paper_submit'].includes(s.type) && s.status === 'completed');
    const complete = steps.every(s => s.status === 'completed' || s.status === 'skipped' || (submitted && ['mock_filing', 'paper_submit'].includes(s.type) && s.status !== 'returned'));
    if (!complete) throw invalidArg('未完了の作業があります。作業状況を確認してください');
    const mockOnly = steps.some(s => s.type === 'mock_filing' && s.status === 'completed') && !steps.some(s => s.type === 'paper_submit' && s.status === 'completed');
    tx.update(ref, { steps, status: 'completed', statusReason: mockOnly ? '模擬申請として完了（実提出の記録は別管理）' : '必要な作業を完了', completedAt: now, updatedAt: now, version: current.version + 1 });
    tx.set(db.collection(`companies/${auth.companyId}/auditLogs`).doc(), { entity: 'procedure', entityId: input.procedureId, action: 'update', changes: { status: { from: current.status, to: 'completed' } }, performedBy: auth.uid, performedAt: now, version: current.version + 1 });
  });
  return { success: true, id: input.procedureId };
}
