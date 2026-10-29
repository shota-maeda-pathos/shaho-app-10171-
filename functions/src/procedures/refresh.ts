import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../config';
import { ProcedureDoc, ProcedureStep, StepStatus, ProcedureStatus } from '../types/firestore';
import { invalidArg } from '../utils/errors';

interface RefreshResult {
  changed: boolean;
  procedure: ProcedureDoc;
}

export async function refreshProcedure(
  companyId: string,
  procedureId: string,
): Promise<RefreshResult> {
  const ref = db.doc(`companies/${companyId}/procedures/${procedureId}`);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error(`Procedure ${procedureId} not found`);
  }
  const proc = snap.data()! as ProcedureDoc;
  if (proc.status === 'cancelled' || proc.status === 'completed') return { changed: false, procedure: proc };

  const updatedSteps = await resolveStepStatuses(companyId, proc);
  const newStatus = deriveOverallStatus(updatedSteps, proc.status);
  const statusReason = buildStatusReason(updatedSteps);

  const stepsChanged = JSON.stringify(proc.steps) !== JSON.stringify(updatedSteps);
  const statusChanged = proc.status !== newStatus || proc.statusReason !== statusReason;

  if (!stepsChanged && !statusChanged) {
    return { changed: false, procedure: proc };
  }

  const now = Timestamp.now();
  const completedAt = newStatus === 'completed' ? now : proc.completedAt;

  const updates: Partial<ProcedureDoc> = {
    steps: updatedSteps,
    status: newStatus,
    statusReason,
    completedAt,
    updatedAt: now,
    version: proc.version + 1,
  };

  await db.runTransaction(async tx => {
    const latest = await tx.get(ref);
    if (!latest.exists || latest.data()!.version !== proc.version) throw invalidArg('手続きが更新されました。再読み込みしてください');
    tx.update(ref, updates);
  });

  return {
    changed: true,
    procedure: { ...proc, ...updates } as ProcedureDoc,
  };
}

export async function resolveStepStatuses(
  companyId: string,
  proc: ProcedureDoc,
  read: (path: string) => Promise<FirebaseFirestore.DocumentSnapshot> = path => db.doc(path).get(),
): Promise<ProcedureStep[]> {
  const steps = proc.steps.map((s) => ({ ...s }));
  // Older hooks linked only document_create. Reuse that filing for approval/submission.
  const filing = proc.references.find(r => r.type === 'filing');
  if (filing && proc.scope === 'individual') {
    for (const step of steps) {
      if (['document_create', 'mock_filing', 'paper_submit'].includes(step.type) || step.type === 'approval') {
        if (!step.referenceId || step.type === 'approval') {
          step.referenceType = 'filing'; step.referenceId = filing.documentId;
        }
      }
    }
  }
  const stepMap = new Map(steps.map((s) => [s.id, s]));

  for (const step of steps) {
    if (step.referenceId && step.referenceType) {
      const refStatus = await readReferenceStatus(companyId, proc, step, read);
      if (refStatus) {
        step.referenceStatus = refStatus.status;
        step.status = refStatus.stepStatus;
        step.statusDetail = refStatus.detail;
        step.actionLabel = refStatus.actionLabel;
        step.actionRoute = refStatus.actionRoute;
        if (refStatus.stepStatus === 'completed' && !step.completedAt) {
          step.completedAt = Timestamp.now();
        }
        if (refStatus.stepStatus !== 'completed') { step.completedAt = null; step.completedBy = null; }
      } else {
        step.status = 'blocked'; step.statusDetail = '関連データが見つかりません';
        step.completedAt = null; step.completedBy = null; step.actionLabel = null;
      }
    }
  }

  for (const step of steps) {
    if (step.referenceId && !['approval', 'mock_filing', 'paper_submit'].includes(step.type)) continue;

    if (step.isConditional && step.status === 'skipped') continue;

    const deps = step.dependsOn
      .map((id) => stepMap.get(id))
      .filter((s): s is ProcedureStep => !!s);

    if (deps.length === 0) {
      if (step.status === 'blocked') step.status = 'available';
      continue;
    }

    const allDepsResolved = deps.every(
      (d) => d.status === 'completed' || d.status === 'skipped',
    );
    const anyDepReturned = deps.some((d) => d.status === 'returned');

    if (anyDepReturned && step.status !== 'completed') {
      step.status = 'blocked';
      step.statusDetail = '先行ステップに差戻しがあります';
    } else if (allDepsResolved) {
      if (step.status === 'blocked') step.status = 'available';
    } else {
      if (step.status !== 'completed') {
        step.status = 'blocked';
      }
    }
  }

  resolveConfirmationDeps(steps, stepMap);

  for (const step of steps) {
    if (step.status === 'blocked') step.actionLabel = null;
    if (step.status !== 'completed' && step.status !== 'skipped' && step.status !== 'blocked') {
      const employeeRoute = proc.employeeId ? `/employees/${encodeURIComponent(proc.employeeId)}` : '/employees/new';
      if (step.type === 'confirmation') step.actionLabel = '内容を確認して完了';
      else if (step.referenceType === 'filing') {
        step.actionLabel ??= step.type === 'approval' ? '届出を確認・承認申請' : '届出を開く';
        step.actionRoute = `/filings/${encodeURIComponent(step.referenceId!)}?employeeId=${encodeURIComponent(proc.employeeId ?? '')}`;
      } else if (!step.actionLabel && step.type !== 'approval') {
        step.actionLabel = step.type === 'document_create' ? '届出を準備' : '入力・確認する';
        step.actionRoute = step.type === 'document_create' ? `/filings?employeeId=${encodeURIComponent(proc.employeeId ?? '')}` : employeeRoute;
      }
    }
  }

  return steps;
}

function resolveConfirmationDeps(
  steps: ProcedureStep[],
  stepMap: Map<string, ProcedureStep>,
): void {
  for (const step of steps) {
    if (step.type !== 'confirmation') continue;

    const deps = step.dependsOn
      .map((id) => stepMap.get(id))
      .filter((s): s is ProcedureStep => !!s);

    const altGroups = findAlternativeGroups(deps);
    if (altGroups.length === 0) continue;

    const anyGroupComplete = altGroups.some((group) =>
      group.some((s) => s.status === 'completed'),
    );
    const nonAltDeps = deps.filter(
      (d) => !altGroups.some((g) => g.includes(d)),
    );
    const nonAltComplete = nonAltDeps.every(
      (d) => d.status === 'completed' || d.status === 'skipped',
    ) && steps.filter(s => s.type !== 'confirmation' && !['mock_filing', 'paper_submit'].includes(s.type))
      .every(s => s.status === 'completed' || s.status === 'skipped');

    if (anyGroupComplete && nonAltComplete) {
      if (step.status !== 'completed') step.status = 'available';
    } else { step.status = 'blocked'; step.completedAt = null; step.completedBy = null; }
  }
}

function findAlternativeGroups(deps: ProcedureStep[]): ProcedureStep[][] {
  const mockFiling = deps.find((d) => d.type === 'mock_filing');
  const paperSubmit = deps.find((d) => d.type === 'paper_submit');
  if (mockFiling && paperSubmit) {
    return [[mockFiling, paperSubmit]];
  }
  return [];
}

interface ReferenceStatusResult {
  status: string;
  stepStatus: StepStatus;
  detail: string | null;
  actionLabel: string | null;
  actionRoute: string | null;
}

async function readReferenceStatus(
  companyId: string,
  proc: ProcedureDoc,
  step: ProcedureStep,
  read: (path: string) => Promise<FirebaseFirestore.DocumentSnapshot>,
): Promise<ReferenceStatusResult | null> {
  const base = `companies/${companyId}`;

  switch (step.referenceType) {
    case 'approval': {
      const empId = findEmployeeIdForStep(proc, step);
      if (!empId) return null;
      const doc = await read(`${base}/employees/${empId}/approvalRequests/${step.referenceId}`);
      if (!doc.exists) return null;
      const data = doc.data()!;
      return mapApprovalStatus(data.status, data.reviewedBy);
    }
    case 'filing': {
      const empId = findEmployeeIdForStep(proc, step);
      if (!empId) return null;
      const doc = await read(`${base}/employees/${empId}/filings/${step.referenceId}`);
      if (!doc.exists) return null;
      const data = doc.data()!;
      return mapFilingStatus(step.type, data);
    }
    case 'employee': {
      const doc = await read(`${base}/employees/${step.referenceId}`);
      if (!doc.exists) return null;
      if (doc.data()!.deletedAt != null) return null;
      return {
        status: 'exists',
        stepStatus: 'completed',
        detail: '登録済み',
        actionLabel: null,
        actionRoute: null,
      };
    }
    default:
      return null;
  }
}

function findEmployeeIdForStep(proc: ProcedureDoc, step: ProcedureStep): string | null {
  const ref = proc.references.find(
    (r) => r.stepId === step.id && r.documentId === step.referenceId,
  );
  return ref?.employeeId ?? proc.employeeId;
}

function mapApprovalStatus(status: string, reviewedBy: string | null): ReferenceStatusResult {
  switch (status) {
    case 'approved':
      return { status, stepStatus: 'completed', detail: `承認済み（${reviewedBy ?? '—'}）`, actionLabel: null, actionRoute: null };
    case 'rejected':
      return { status, stepStatus: 'returned', detail: '差戻し', actionLabel: '再申請', actionRoute: null };
    case 'pending':
      return { status, stepStatus: 'in_progress', detail: '承認待ち', actionLabel: null, actionRoute: null };
    case 'cancelled':
      return { status, stepStatus: 'returned', detail: '取消済み', actionLabel: '再申請', actionRoute: null };
    default:
      return { status, stepStatus: 'in_progress', detail: null, actionLabel: null, actionRoute: null };
  }
}

function mapFilingStatus(
  stepType: string,
  data: FirebaseFirestore.DocumentData,
): ReferenceStatusResult {
  if (stepType === 'approval') {
    const state = data.workflowStatus;
    if (state === 'approved') return mapApprovalStatus('approved', null);
    if (state === 'rejected') return mapApprovalStatus('rejected', null);
    if (state === 'pending') return mapApprovalStatus('pending', null);
    return { status: state ?? 'draft', stepStatus: 'available', detail: '社内承認が必要です', actionLabel: '届出を確認・承認申請', actionRoute: null };
  }
  if (stepType === 'mock_filing') {
    switch (data.mockStatus) {
      case 'completed':
        return { status: 'completed', stepStatus: 'completed', detail: '模擬電子申請完了', actionLabel: null, actionRoute: null };
      case 'failed':
        return { status: 'failed', stepStatus: 'returned', detail: '模擬電子申請失敗', actionLabel: '再申請', actionRoute: null };
      case 'processing':
        return { status: 'processing', stepStatus: 'in_progress', detail: '処理中', actionLabel: null, actionRoute: null };
      default:
        return { status: 'notStarted', stepStatus: 'in_progress', detail: '申請可能', actionLabel: '模擬電子申請', actionRoute: null };
    }
  }

  if (stepType === 'paper_submit') {
    switch (data.submissionStatus) {
      case 'received':
      case 'accepted':
        return { status: 'accepted', stepStatus: 'completed', detail: '受理済み', actionLabel: null, actionRoute: null };
      case 'returned':
        return { status: 'returned', stepStatus: 'returned', detail: '返戻', actionLabel: '再提出', actionRoute: null };
      case 'submitted':
        return { status: 'submitted', stepStatus: 'in_progress', detail: '提出済み（結果待ち）', actionLabel: null, actionRoute: null };
      default:
        return { status: 'notSubmitted', stepStatus: 'in_progress', detail: '提出可能', actionLabel: '提出結果を記録', actionRoute: null };
    }
  }

  // document_create step
  if (data.workflowStatus === 'rejected') {
    return { status: 'rejected', stepStatus: 'returned', detail: '届出が差戻しされました', actionLabel: '修正', actionRoute: null };
  }
  return { status: data.workflowStatus, stepStatus: 'completed', detail: '作成済み', actionLabel: null, actionRoute: null };
}

function deriveOverallStatus(steps: ProcedureStep[], currentStatus: ProcedureStatus): ProcedureStatus {
  if (currentStatus === 'cancelled') return 'cancelled';

  const nonSkipped = steps.filter((s) => s.status !== 'skipped');
  if (nonSkipped.length === 0) return currentStatus;

  const hasSubmission = steps.some(s => ['mock_filing', 'paper_submit'].includes(s.type) && s.status === 'completed');
  const allCompleted = nonSkipped.every((s) => s.status === 'completed' || (hasSubmission && ['mock_filing', 'paper_submit'].includes(s.type) && s.status !== 'returned'));
  if (allCompleted) return 'completed';

  const anyInProgressOrReturned = nonSkipped.some(
    (s) => s.status === 'in_progress' || s.status === 'returned' || s.status === 'available',
  );
  if (anyInProgressOrReturned) return 'in_progress';

  return currentStatus;
}

function buildStatusReason(steps: ProcedureStep[]): string {
  const returned = steps.filter((s) => s.status === 'returned');
  if (returned.length > 0) {
    return returned.map((s) => `${s.label}: ${s.statusDetail ?? '要対応'}`).join('、');
  }

  const inProgress = steps.filter((s) => s.status === 'in_progress');
  if (inProgress.length > 0) {
    return inProgress.map((s) => `${s.label}: ${s.statusDetail ?? '進行中'}`).join('、');
  }

  const available = steps.filter((s) => s.status === 'available');
  if (available.length > 0) {
    return available.map((s) => s.label).join('、') + ' が着手可能';
  }

  const allCompleted = steps.every((s) => s.status === 'completed' || s.status === 'skipped');
  if (allCompleted) return '全ステップ完了';

  return '';
}
