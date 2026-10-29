import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext } from '../../middleware/auth';
import { requireProcedureAccess } from '../access';
import { notFound, invalidArg } from '../../utils/errors';
import { ProcedureDoc } from '../../types/firestore';
import { MutationResponse } from '../../types/response';
import { ProcedureCancelInput } from './schema';

export async function cancelProcedure(
  input: ProcedureCancelInput,
  auth: AuthContext,
): Promise<MutationResponse> {
  const base = `companies/${auth.companyId}`;
  const ref = db.doc(`${base}/procedures/${input.procedureId}`);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw notFound('手続き');

    const proc = snap.data()! as ProcedureDoc;
    if (proc.deletedAt !== null) throw notFound('手続き');

    requireProcedureAccess(auth, proc);

    if (proc.version !== input.expectedVersion) {
      throw invalidArg(`版番号が一致しません（現行: ${proc.version}, 指定: ${input.expectedVersion}）`);
    }

    if (proc.status === 'completed') {
      throw invalidArg('完了済みの手続きは取消できません');
    }
    if (proc.status === 'cancelled') {
      throw invalidArg('既に取消済みです');
    }

    const now = Timestamp.now();
    tx.update(ref, {
      status: 'cancelled',
      statusReason: `取消: ${input.reason}`,
      updatedAt: now,
      version: proc.version + 1,
    });

    const auditRef = db.collection(`${base}/auditLogs`).doc();
    tx.set(auditRef, {
      entity: 'procedure',
      entityId: input.procedureId,
      action: 'update',
      changes: { status: { from: proc.status, to: 'cancelled' } },
      performedBy: auth.uid,
      performedAt: now,
      version: proc.version + 1,
    });

    return { success: true as const, id: input.procedureId };
  });
}
