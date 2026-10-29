import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { invalidArg } from '../../utils/errors';
import { toTimestamp } from '../../utils/firestore';
import { MutationResponse } from '../../types/response';
import { ProcedureCreateInput } from './schema';
import { buildSteps, buildTitle } from '../templates';

export async function createProcedure(
  input: ProcedureCreateInput,
  auth: AuthContext,
): Promise<MutationResponse> {
  if (!auth.roles.includes('admin')) {
    requireOffice(auth, input.officeId);
    if (input.targetOfficeId) {
      requireOffice(auth, input.targetOfficeId);
    }
  }

  const base = `companies/${auth.companyId}`;

  // Duplicate check: same employee + type + active procedure
  if (input.scope === 'individual' && input.employeeId) {
    const existing = await db
      .collection(`${base}/procedures`)
      .where('employeeId', '==', input.employeeId)
      .where('procedureType', '==', input.procedureType)
      .where('status', 'in', ['draft', 'in_progress'])
      .where('deletedAt', '==', null)
      .limit(1)
      .get();
    if (!existing.empty) {
      throw invalidArg('この従業員に同じ種別の進行中手続きが既に存在します');
    }
  }

  // Batch duplicate check: same office + yearMonth + type
  if (input.scope === 'batch' && input.batchMeta) {
    const existing = await db
      .collection(`${base}/procedures`)
      .where('officeId', '==', input.officeId)
      .where('procedureType', '==', input.procedureType)
      .where('status', 'in', ['draft', 'in_progress'])
      .where('deletedAt', '==', null)
      .limit(1)
      .get();
    if (!existing.empty) {
      const found = existing.docs[0].data();
      if (found.batchMeta?.targetYearMonth === input.batchMeta.targetYearMonth) {
        throw invalidArg('同じ事業所・年月の手続きが既に存在します');
      }
    }
  }

  const now = Timestamp.now();
  const steps = buildSteps(input.procedureType);
  const title = buildTitle(input.procedureType, input.employeeName);

  const docRef = db.collection(`${base}/procedures`).doc();

  const batchMeta = input.scope === 'batch' && input.batchMeta
    ? {
        targetYearMonth: input.batchMeta.targetYearMonth,
        targetEmployeeIds: input.batchMeta.targetEmployeeIds,
        processedCount: 0,
        totalCount: input.batchMeta.targetEmployeeIds.length,
      }
    : null;

  await docRef.set({
    procedureType: input.procedureType,
    title,
    priority: input.priority,
    status: 'in_progress',
    statusReason: steps.filter((s) => s.status === 'available').map((s) => s.label).join('、') + ' が着手可能',
    employeeId: input.employeeId ?? null,
    employeeName: input.employeeName,
    officeId: input.officeId,
    targetOfficeId: input.targetOfficeId ?? null,
    scope: input.scope,
    batchMeta,
    invitationId: input.invitationId ?? null,
    onboardToken: input.onboardToken ?? null,
    steps,
    deadline: input.deadline ? toTimestamp(input.deadline) : null,
    effectiveDate: input.effectiveDate ? toTimestamp(input.effectiveDate) : null,
    assignedTo: input.assignedTo ?? auth.uid,
    createdBy: auth.uid,
    references: [],
    notes: input.notes,
    version: 1,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    deletedAt: null,
  });

  const auditRef = db.collection(`${base}/auditLogs`).doc();
  await auditRef.set({
    entity: 'procedure',
    entityId: docRef.id,
    action: 'create',
    changes: {},
    performedBy: auth.uid,
    performedAt: now,
    version: 1,
  });

  return { success: true, id: docRef.id };
}
