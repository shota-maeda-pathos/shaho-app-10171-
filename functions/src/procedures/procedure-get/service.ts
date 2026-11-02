import { AuthContext } from '../../middleware/auth';
import { db } from '../../config';
import { requireProcedureAccess } from '../access';
import { notFound } from '../../utils/errors';
import { ProcedureDoc } from '../../types/firestore';
import { toISOString, toNullableISO, toNullableDateString } from '../../utils/firestore';
import { refreshProcedure } from '../refresh';
import { ProcedureGetInput } from './schema';

export interface ProcedureGetResponse {
  id: string;
  procedureType: string;
  title: string;
  priority: string;
  status: string;
  statusReason: string;
  employeeId: string | null;
  employeeName: string;
  officeId: string;
  targetOfficeId: string | null;
  scope: string;
  batchMeta: {
    targetYearMonth: string;
    targetEmployeeIds: string[];
    processedCount: number;
    totalCount: number;
  } | null;
  invitationId: string | null;
  steps: {
    id: string;
    label: string;
    type: string;
    dependsOn: string[];
    isConditional: boolean;
    condition: string | null;
    status: string;
    statusDetail: string | null;
    referenceType: string | null;
    referenceId: string | null;
    referenceStatus: string | null;
    actionLabel: string | null;
    actionRoute: string | null;
    completedAt: string | null;
    completedBy: string | null;
  }[];
  deadline: string | null;
  effectiveDate: string | null;
  assignedTo: string;
  createdBy: string;
  /** 始めた人の表示名（手続きをやめるボタンで「〇〇さんに頼んでください」と出すため。getProcedure だけが入れる） */
  createdByName?: string | null;
  references: {
    type: string;
    documentId: string;
    employeeId: string | null;
    documentSubtype: string | null;
    stepId: string;
    createdAt: string;
  }[];
  notes: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export async function getProcedure(
  input: ProcedureGetInput,
  auth: AuthContext,
): Promise<ProcedureGetResponse> {
  const initial = await db.doc(`companies/${auth.companyId}/procedures/${input.procedureId}`).get();
  if (!initial.exists) throw notFound('手続き');
  // Validate before refreshing: refresh reads related records and may write state.
  requireProcedureAccess(auth, initial.data() as ProcedureDoc);
  // 「この手続きをやめる」などの読むだけの呼び出しでは計算し直さない（ウィザードが持つ version が古くなり、保存がぶつかるため）
  const proc = input.refresh !== false ? (await refreshProcedure(auth.companyId, input.procedureId)).procedure : (initial.data() as ProcedureDoc);

  if (proc.deletedAt !== null) throw notFound('手続き');

  requireProcedureAccess(auth, proc);

  const creator = proc.createdBy ? await db.doc(`companies/${auth.companyId}/users/${proc.createdBy}`).get() : null;
  return { ...toProcedureResponse(input.procedureId, proc), createdByName: (creator?.data()?.displayName as string | undefined) ?? null };
}

export function toProcedureResponse(id: string, proc: ProcedureDoc): ProcedureGetResponse {
  return {
    id,
    procedureType: proc.procedureType,
    title: proc.title,
    priority: proc.priority,
    status: proc.status,
    statusReason: proc.statusReason,
    employeeId: proc.employeeId,
    employeeName: proc.employeeName,
    officeId: proc.officeId,
    targetOfficeId: proc.targetOfficeId,
    scope: proc.scope,
    batchMeta: proc.batchMeta,
    invitationId: proc.invitationId,
    steps: proc.steps.map((s) => ({
      id: s.id,
      label: s.label,
      type: s.type,
      dependsOn: s.dependsOn,
      isConditional: s.isConditional,
      condition: s.condition,
      status: s.status,
      statusDetail: s.statusDetail,
      referenceType: s.referenceType,
      referenceId: s.referenceId,
      referenceStatus: s.referenceStatus,
      actionLabel: s.actionLabel,
      actionRoute: s.actionRoute,
      completedAt: s.completedAt ? toISOString(s.completedAt) : null,
      completedBy: s.completedBy,
    })),
    deadline: proc.deadline ? toNullableDateString(proc.deadline) : null,
    effectiveDate: proc.effectiveDate ? toNullableDateString(proc.effectiveDate) : null,
    assignedTo: proc.assignedTo,
    createdBy: proc.createdBy,
    references: proc.references.map((r) => ({
      type: r.type,
      documentId: r.documentId,
      employeeId: r.employeeId,
      documentSubtype: r.documentSubtype,
      stepId: r.stepId,
      createdAt: toISOString(r.createdAt),
    })),
    notes: proc.notes,
    version: proc.version,
    createdAt: toISOString(proc.createdAt),
    updatedAt: toISOString(proc.updatedAt),
    completedAt: toNullableISO(proc.completedAt),
  };
}
