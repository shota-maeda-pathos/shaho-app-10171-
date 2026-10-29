import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext } from '../../middleware/auth';
import { requireProcedureAccess } from '../access';
import { notFound, invalidArg } from '../../utils/errors';
import { ProcedureDoc } from '../../types/firestore';
import { MutationResponse } from '../../types/response';
import { ProcedureUpdateInput } from './schema';

export async function updateProcedure(
  input: ProcedureUpdateInput,
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

    if (proc.status === 'completed' || proc.status === 'cancelled') {
      throw invalidArg('完了または取消済みの手続きは更新できません');
    }

    const now = Timestamp.now();
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const updates: Record<string, unknown> = {
      updatedAt: now,
      version: proc.version + 1,
    };

    if (input.notes !== undefined && input.notes !== proc.notes) {
      changes['notes'] = { from: proc.notes, to: input.notes };
      updates['notes'] = input.notes;
    }
    if (input.assignedTo !== undefined && input.assignedTo !== proc.assignedTo) {
      changes['assignedTo'] = { from: proc.assignedTo, to: input.assignedTo };
      updates['assignedTo'] = input.assignedTo;
    }
    if (input.priority !== undefined && input.priority !== proc.priority) {
      changes['priority'] = { from: proc.priority, to: input.priority };
      updates['priority'] = input.priority;
    }

    tx.update(ref, updates);

    const auditRef = db.collection(`${base}/auditLogs`).doc();
    tx.set(auditRef, {
      entity: 'procedure',
      entityId: input.procedureId,
      action: 'update',
      changes,
      performedBy: auth.uid,
      performedAt: now,
      version: proc.version + 1,
    });

    return { success: true as const, id: input.procedureId };
  });
}
