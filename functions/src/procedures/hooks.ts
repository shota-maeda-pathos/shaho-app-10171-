import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../config';
import { ProcedureDoc, ProcedureReference, ProcedureType } from '../types/firestore';
import { buildSteps, buildTitle, buildBatchTitle } from './templates';
import { toTimestamp } from '../utils/firestore';
import { refreshProcedure } from './refresh';

// A filing must never be attached to the first unrelated open case for this person.
export function filingMatchesProcedure(type: ProcedureType, filingType: string): boolean {
  const allowed: Partial<Record<ProcedureType, string[]>> = {
    acquisition: ['acquisitionNotification'], loss: ['lossNotification'],
    dependent_change: ['dependentChange'], maternity_leave: ['maternityLeaveStart', 'maternityLeaveChange'],
    childcare_leave: ['childcareLeaveStart', 'childcareLeaveEnd'],
    monthly_change: ['remunerationMonthlyChange'], annual_review: ['remunerationMonthlyAlgorithm'],
    bonus_payment: ['bonusPayment'], age_event: ['lossNotification'],
  };
  return allowed[type]?.includes(filingType) ?? false;
}

export async function createAcquisitionProcedure(params: {
  companyId: string;
  employeeId: string;
  employeeName: string;
  officeId: string;
  effectiveDate: string;
  filingId: string | null;
  createdBy: string;
}): Promise<string> {
  const { companyId, employeeId, employeeName, officeId, effectiveDate, filingId, createdBy } = params;
  const base = `companies/${companyId}`;
  const now = Timestamp.now();

  const steps = buildSteps('acquisition');
  const title = buildTitle('acquisition', employeeName);

  const empStep = steps.find((s) => s.id === 'emp_register');
  if (empStep) {
    empStep.status = 'completed';
    empStep.referenceType = 'employee';
    empStep.referenceId = employeeId;
    empStep.completedAt = now;
    empStep.completedBy = createdBy;
  }

  if (filingId) {
    const filingStep = steps.find((s) => s.id === 'filing_create');
    if (filingStep) {
      filingStep.status = 'completed';
      filingStep.referenceType = 'filing';
      filingStep.referenceId = filingId;
      filingStep.completedAt = now;
      filingStep.completedBy = createdBy;
    }

    const mockStep = steps.find((s) => s.id === 'mock_filing');
    if (mockStep) {
      mockStep.referenceType = 'filing';
      mockStep.referenceId = filingId;
    }
    const paperStep = steps.find((s) => s.id === 'paper_submit');
    if (paperStep) {
      paperStep.referenceType = 'filing';
      paperStep.referenceId = filingId;
    }
  }

  for (const step of steps) {
    if (step.status !== 'blocked') continue;
    const allDepsComplete = step.dependsOn.every((depId) => {
      const dep = steps.find((s) => s.id === depId);
      return dep && (dep.status === 'completed' || dep.status === 'skipped');
    });
    if (allDepsComplete) step.status = 'available';
  }

  const references: ProcedureReference[] = [
    {
      type: 'employee',
      documentId: employeeId,
      employeeId,
      documentSubtype: null,
      stepId: 'emp_register',
      createdAt: now,
    },
  ];
  if (filingId) {
    references.push({
      type: 'filing',
      documentId: filingId,
      employeeId,
      documentSubtype: 'acquisitionNotification',
      stepId: 'filing_create',
      createdAt: now,
    });
  }

  const statusReason = steps
    .filter((s) => s.status === 'available')
    .map((s) => s.label)
    .join('、') + ' が着手可能';

  const docRef = db.collection(`${base}/procedures`).doc();
  await docRef.set({
    procedureType: 'acquisition' as ProcedureType,
    title,
    priority: 'normal' as const,
    status: 'in_progress' as const,
    statusReason,
    employeeId,
    employeeName,
    officeId,
    targetOfficeId: null,
    scope: 'individual' as const,
    batchMeta: null,
    invitationId: null,
    onboardToken: null,
    steps,
    deadline: null,
    effectiveDate: toTimestamp(effectiveDate),
    assignedTo: createdBy,
    createdBy,
    references,
    notes: '',
    version: 1,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    deletedAt: null,
  });

  return docRef.id;
}

export async function createLossProcedure(params: {
  companyId: string;
  employeeId: string;
  employeeName: string;
  officeId: string;
  resignationDate: string;
  lossDate: string;
  filingId: string | null;
  hasFinalSettlement: boolean;
  userSuspended: boolean;
  createdBy: string;
}): Promise<string> {
  const { companyId, employeeId, employeeName, officeId, lossDate, filingId, hasFinalSettlement, userSuspended, createdBy } = params;
  const base = `companies/${companyId}`;
  const now = Timestamp.now();

  const steps = buildSteps('loss');
  const title = buildTitle('loss', employeeName);

  const resignStep = steps.find((s) => s.id === 'resign_entry');
  if (resignStep) {
    resignStep.status = 'completed';
    resignStep.referenceType = 'employee';
    resignStep.referenceId = employeeId;
    resignStep.completedAt = now;
    resignStep.completedBy = createdBy;
  }

  if (hasFinalSettlement) {
    const salaryStep = steps.find((s) => s.id === 'final_salary');
    if (salaryStep) {
      salaryStep.status = 'completed';
      salaryStep.statusDetail = '精算データ作成済み';
      salaryStep.completedAt = now;
      salaryStep.completedBy = createdBy;
    }
  }

  if (filingId) {
    const filingStep = steps.find((s) => s.id === 'filing_create');
    if (filingStep) {
      filingStep.status = 'completed';
      filingStep.referenceType = 'filing';
      filingStep.referenceId = filingId;
      filingStep.completedAt = now;
      filingStep.completedBy = createdBy;
    }

    const mockStep = steps.find((s) => s.id === 'mock_filing');
    if (mockStep) {
      mockStep.referenceType = 'filing';
      mockStep.referenceId = filingId;
    }
    const paperStep = steps.find((s) => s.id === 'paper_submit');
    if (paperStep) {
      paperStep.referenceType = 'filing';
      paperStep.referenceId = filingId;
    }
  }

  if (userSuspended) {
    const portalStep = steps.find((s) => s.id === 'portal_access');
    if (portalStep) {
      portalStep.status = 'completed';
      portalStep.statusDetail = 'アカウント停止済み';
      portalStep.completedAt = now;
      portalStep.completedBy = createdBy;
    }
  }

  for (const step of steps) {
    if (step.status !== 'blocked') continue;
    const allDepsComplete = step.dependsOn.every((depId) => {
      const dep = steps.find((s) => s.id === depId);
      return dep && (dep.status === 'completed' || dep.status === 'skipped');
    });
    if (allDepsComplete) step.status = 'available';
  }

  const references: ProcedureReference[] = [
    {
      type: 'employee',
      documentId: employeeId,
      employeeId,
      documentSubtype: null,
      stepId: 'resign_entry',
      createdAt: now,
    },
  ];
  if (filingId) {
    references.push({
      type: 'filing',
      documentId: filingId,
      employeeId,
      documentSubtype: 'lossNotification',
      stepId: 'filing_create',
      createdAt: now,
    });
  }

  const statusReason = steps
    .filter((s) => s.status === 'available')
    .map((s) => s.label)
    .join('、') + ' が着手可能';

  const docRef = db.collection(`${base}/procedures`).doc();
  await docRef.set({
    procedureType: 'loss' as ProcedureType,
    title,
    priority: 'normal' as const,
    status: 'in_progress' as const,
    statusReason,
    employeeId,
    employeeName,
    officeId,
    targetOfficeId: null,
    scope: 'individual' as const,
    batchMeta: null,
    invitationId: null,
    onboardToken: null,
    steps,
    deadline: null,
    effectiveDate: toTimestamp(lossDate),
    assignedTo: createdBy,
    createdBy,
    references,
    notes: '',
    version: 1,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    deletedAt: null,
  });

  return docRef.id;
}

export async function linkApprovalToProcedure(params: {
  companyId: string;
  employeeId: string;
  filingId: string;
  approvalRequestId: string;
}): Promise<void> {
  const { companyId, employeeId, filingId, approvalRequestId } = params;
  const procs = await db
    .collection(`companies/${companyId}/procedures`)
    .where('employeeId', '==', employeeId)
    .where('status', 'in', ['draft', 'in_progress'])
    .where('deletedAt', '==', null)
    .get();

  for (const doc of procs.docs) {
    const proc = doc.data() as ProcedureDoc;
    const approvalStep = proc.steps.find((s) => s.id === 'approval' || s.type === 'approval');
    if (!approvalStep || approvalStep.referenceId) continue;

    const hasFilingRef = proc.references.some(
      (r) => r.type === 'filing' && r.documentId === filingId,
    );
    if (!hasFilingRef) continue;

    approvalStep.referenceType = 'approval';
    approvalStep.referenceId = approvalRequestId;

    const now = Timestamp.now();
    proc.references.push({
      type: 'approval',
      documentId: approvalRequestId,
      employeeId,
      documentSubtype: null,
      stepId: approvalStep.id,
      createdAt: now,
    });

    await db.doc(`companies/${companyId}/procedures/${doc.id}`).update({
      steps: proc.steps,
      references: proc.references,
      updatedAt: now,
      version: proc.version + 1,
    });
  }
}

export async function createSimpleProcedure(params: {
  companyId: string;
  procedureType: ProcedureType;
  employeeId: string;
  employeeName: string;
  officeId: string;
  effectiveDate: string;
  completedStepId: string;
  createdBy: string;
}): Promise<string> {
  const { companyId, procedureType, employeeId, employeeName, officeId, effectiveDate, completedStepId, createdBy } = params;
  const base = `companies/${companyId}`;
  const now = Timestamp.now();

  const steps = buildSteps(procedureType);
  const title = buildTitle(procedureType, employeeName);

  const doneStep = steps.find((s) => s.id === completedStepId);
  if (doneStep) {
    doneStep.status = 'completed';
    doneStep.completedAt = now;
    doneStep.completedBy = createdBy;
  }

  for (const step of steps) {
    if (step.status !== 'blocked') continue;
    const allDepsComplete = step.dependsOn.every((depId) => {
      const dep = steps.find((s) => s.id === depId);
      return dep && (dep.status === 'completed' || dep.status === 'skipped');
    });
    if (allDepsComplete) step.status = 'available';
  }

  const references: ProcedureReference[] = [{
    type: 'employee',
    documentId: employeeId,
    employeeId,
    documentSubtype: null,
    stepId: completedStepId,
    createdAt: now,
  }];

  const statusReason = steps
    .filter((s) => s.status === 'available')
    .map((s) => s.label)
    .join('、') + ' が着手可能';

  const docRef = db.collection(`${base}/procedures`).doc();
  await docRef.set({
    procedureType,
    title,
    priority: 'normal' as const,
    status: 'in_progress' as const,
    statusReason,
    employeeId,
    employeeName,
    officeId,
    targetOfficeId: null,
    scope: 'individual' as const,
    batchMeta: null,
    invitationId: null,
    onboardToken: null,
    steps,
    deadline: null,
    effectiveDate: toTimestamp(effectiveDate),
    assignedTo: createdBy,
    createdBy,
    references,
    notes: '',
    version: 1,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    deletedAt: null,
  });

  return docRef.id;
}

export async function linkFilingToProcedure(params: {
  companyId: string;
  employeeId: string;
  filingId: string;
  filingType: string;
}): Promise<void> {
  const { companyId, employeeId, filingId, filingType } = params;
  const procs = await db
    .collection(`companies/${companyId}/procedures`)
    .where('employeeId', '==', employeeId)
    .where('status', 'in', ['draft', 'in_progress'])
    .where('deletedAt', '==', null)
    .get();

  for (const doc of procs.docs) {
    const proc = doc.data() as ProcedureDoc;
    const filingStep = proc.steps.find((s) => s.id === 'filing_create' && !s.referenceId);
    if (!filingStep || !filingMatchesProcedure(proc.procedureType, filingType)) continue;

    filingStep.status = 'completed';
    filingStep.referenceType = 'filing';
    filingStep.referenceId = filingId;
    filingStep.completedAt = Timestamp.now();

    const mockStep = proc.steps.find((s) => s.id === 'mock_filing');
    if (mockStep && !mockStep.referenceId) {
      mockStep.referenceType = 'filing';
      mockStep.referenceId = filingId;
    }
    const paperStep = proc.steps.find((s) => s.id === 'paper_submit');
    if (paperStep && !paperStep.referenceId) {
      paperStep.referenceType = 'filing';
      paperStep.referenceId = filingId;
    }

    for (const step of proc.steps) {
      if (step.status !== 'blocked') continue;
      const allDepsComplete = step.dependsOn.every((depId) => {
        const dep = proc.steps.find((s) => s.id === depId);
        return dep && (dep.status === 'completed' || dep.status === 'skipped');
      });
      if (allDepsComplete) step.status = 'available';
    }

    const now = Timestamp.now();
    proc.references.push({
      type: 'filing',
      documentId: filingId,
      employeeId,
      documentSubtype: filingType,
      stepId: 'filing_create',
      createdAt: now,
    });

    await db.doc(`companies/${companyId}/procedures/${doc.id}`).update({
      steps: proc.steps,
      references: proc.references,
      updatedAt: now,
      version: proc.version + 1,
    });
    break;
  }
}

export async function createBatchProcedure(params: {
  companyId: string;
  procedureType: ProcedureType;
  officeId: string;
  targetYearMonth: string;
  targetEmployeeIds: string[];
  completedStepId: string;
  createdBy: string;
}): Promise<string> {
  const { companyId, procedureType, officeId, targetYearMonth, targetEmployeeIds, completedStepId, createdBy } = params;
  const base = `companies/${companyId}`;
  const now = Timestamp.now();

  const existing = await db
    .collection(`${base}/procedures`)
    .where('officeId', '==', officeId)
    .where('procedureType', '==', procedureType)
    .where('scope', '==', 'batch')
    .where('status', 'in', ['draft', 'in_progress'])
    .where('deletedAt', '==', null)
    .limit(1)
    .get();

  if (!existing.empty) {
    const found = existing.docs[0].data() as ProcedureDoc;
    if (found.batchMeta?.targetYearMonth === targetYearMonth) {
      return existing.docs[0].id;
    }
  }

  const steps = buildSteps(procedureType);
  const title = buildBatchTitle(procedureType, targetYearMonth);

  const doneStep = steps.find((s) => s.id === completedStepId);
  if (doneStep) {
    doneStep.status = 'completed';
    doneStep.completedAt = now;
    doneStep.completedBy = createdBy;
  }

  for (const step of steps) {
    if (step.status !== 'blocked') continue;
    const allDepsComplete = step.dependsOn.every((depId) => {
      const dep = steps.find((s) => s.id === depId);
      return dep && (dep.status === 'completed' || dep.status === 'skipped');
    });
    if (allDepsComplete) step.status = 'available';
  }

  const statusReason = steps
    .filter((s) => s.status === 'available')
    .map((s) => s.label)
    .join('、') + ' が着手可能';

  const docRef = db.collection(`${base}/procedures`).doc();
  await docRef.set({
    procedureType,
    title,
    priority: 'normal' as const,
    status: 'in_progress' as const,
    statusReason,
    employeeId: null,
    employeeName: title,
    officeId,
    targetOfficeId: null,
    scope: 'batch' as const,
    batchMeta: {
      targetYearMonth,
      targetEmployeeIds,
      processedCount: 0,
      totalCount: targetEmployeeIds.length,
    },
    invitationId: null,
    onboardToken: null,
    steps,
    deadline: null,
    effectiveDate: null,
    assignedTo: createdBy,
    createdBy,
    references: [],
    notes: '',
    version: 1,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    deletedAt: null,
  });

  return docRef.id;
}

export async function advanceBatchStep(params: {
  companyId: string;
  procedureId: string;
  stepId: string;
  completedBy: string;
}): Promise<void> {
  const { companyId, procedureId, stepId, completedBy } = params;
  const docRef = db.doc(`companies/${companyId}/procedures/${procedureId}`);
  const snap = await docRef.get();
  if (!snap.exists) return;

  const proc = snap.data() as ProcedureDoc;
  const step = proc.steps.find((s) => s.id === stepId);
  if (!step || step.status === 'completed') return;

  const now = Timestamp.now();
  step.status = 'completed';
  step.completedAt = now;
  step.completedBy = completedBy;

  for (const s of proc.steps) {
    if (s.status !== 'blocked') continue;
    const allDepsComplete = s.dependsOn.every((depId) => {
      const dep = proc.steps.find((d) => d.id === depId);
      return dep && (dep.status === 'completed' || dep.status === 'skipped');
    });
    if (allDepsComplete) s.status = 'available';
  }

  const allDone = proc.steps.every((s) => s.status === 'completed' || s.status === 'skipped');
  const statusReason = allDone
    ? '全ステップ完了'
    : proc.steps.filter((s) => s.status === 'available').map((s) => s.label).join('、') + ' が着手可能';

  await docRef.update({
    steps: proc.steps,
    status: allDone ? 'completed' : 'in_progress',
    statusReason,
    completedAt: allDone ? now : null,
    updatedAt: now,
    version: proc.version + 1,
  });
}

export async function refreshEmployeeProcedures(
  companyId: string,
  employeeId: string,
): Promise<void> {
  const procs = await db
    .collection(`companies/${companyId}/procedures`)
    .where('employeeId', '==', employeeId)
    .where('status', 'in', ['draft', 'in_progress'])
    .where('deletedAt', '==', null)
    .get();

  for (const doc of procs.docs) {
    await refreshProcedure(companyId, doc.id);
  }
}
