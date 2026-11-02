import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../config';
import { AuthContext, requireOffice } from '../middleware/auth';
import {
  EmployeeDoc, EmploymentDoc, FilingDoc, LeavePeriodState, LeaveProcedureState, OfficeDoc, ProcedureDoc, ProcedureStep,
} from '../types/firestore';
import { invalidArg, notFound } from '../utils/errors';
import { toDateString, toTimestamp } from '../utils/firestore';
import { normalizeEmployment } from '../utils/employment';
import { addDays, addMonths } from '../insurance/calculator';
import { buildLeaveWizardSteps } from '../procedures/templates';
import { requireProcedureAccess } from '../procedures/access';
import { refreshProcedure } from '../procedures/refresh';
import { completed, latestApprovalId, requireVersion, setStep, statusReasonOf, stepOf, todayJst } from '../procedures/wizard';
import { createApprovalRequest } from '../approvals/approval-request-create/service';
import { confirmProcedure } from '../procedures/procedure-action/service';
import {
  childcareLimits, FILING_LABEL, FILING_TYPE, judgeLeaveEvent, KIND_LABEL, LeaveEventType, LeaveFacts, LeaveFilingKind,
  planChildcare, planMaternity, returnMonth,
} from './rules';
import { PlanInput, PreviewInput } from './schema';

type LeaveProc = ProcedureDoc & { leaveProcedure: LeaveProcedureState };
type Kind = LeaveProcedureState['kind'];

const nameOf = (e: { lastName: string; firstName: string }) => `${e.lastName} ${e.firstName}`;
const SHORT: Record<Kind, string> = { maternity: '産休', childcare: '育休' };

// ── 開始 ────────────────────────────────────────────

/**
 * 進行中の休業の手続きに、本人からの申請の出産予定日・子・期間を入れる。期間をまだ保存していないときだけ、空いている項目にだけ入れる
 * （保存後・届出の作成後は、担当者がウィザードで手で直す）
 */
async function fillFromRequest(companyId: string, ref: FirebaseFirestore.DocumentReference, employeeId: string, kind: Kind, requestId: string) {
  const { leaveStateFromRequest, loadRequestForHandoff } = await import('../portal/handoff');
  const req = await loadRequestForHandoff(companyId, requestId, employeeId, ['leave']);
  if (req.detail.kind !== kind) throw invalidArg('申請の休業の種類と違います');
  const s = leaveStateFromRequest(kind, req.detail);
  return db.runTransaction(async tx => {
    const latest = (await tx.get(ref)).data() as LeaveProc;
    const lp = latest.leaveProcedure;
    if (lp.period || lp.filingId) return false;
    tx.update(ref, {
      'leaveProcedure.expectedBirthDate': lp.expectedBirthDate ?? s.expectedBirthDate,
      'leaveProcedure.child': lp.child ?? s.child,
      'leaveProcedure.period': s.period,
      version: latest.version + 1, updatedAt: Timestamp.now(),
    });
    return true;
  });
}

export async function startLeave(input: { employeeId: string; kind: Kind; sourceProcedureId: string | null; sourceRequestId?: string | null }, auth: AuthContext) {
  const base = `companies/${auth.companyId}`;
  const empPath = `${base}/employees/${input.employeeId}`;
  const [empSnap, employmentSnap] = await Promise.all([
    db.doc(empPath).get(),
    db.collection(`${empPath}/employments`).orderBy('effectiveDate', 'desc').limit(1).get(),
  ]);
  if (!empSnap.exists || empSnap.data()!.deletedAt !== null) throw notFound('従業員');
  const employee = empSnap.data() as EmployeeDoc;
  requireOffice(auth, employee.officeId);
  if (!employee.isActive) throw invalidArg('退職した人の休業は登録できません');
  const employment = employmentSnap.empty ? null : normalizeEmployment(employmentSnap.docs[0].data() as EmploymentDoc);
  if (employment && !employment.healthInsuranceEnrolled && !employment.pensionEnrolled) {
    throw invalidArg('社会保険に加入していないため、休業の申出書と保険料の免除はありません');
  }
  if (input.kind === 'maternity' && employee.gender !== 'female') throw invalidArg('産休は出産する本人が取る休業です。配偶者の出産で休む場合は育休を選んでください');

  // 同じ人の進行中の同じ種類の休業があれば、それを開く（二重に始めない）
  const existing = await db.collection(`${base}/procedures`).where('employeeId', '==', input.employeeId).where('deletedAt', '==', null).get();
  const open = existing.docs.find(d => {
    const p = d.data() as ProcedureDoc;
    return p.leaveProcedure?.kind === input.kind && p.status === 'in_progress';
  });
  if (open) {
    const prefilled = input.sourceRequestId ? await fillFromRequest(auth.companyId, open.ref, input.employeeId, input.kind, input.sourceRequestId) : false;
    return { procedureId: open.id, existing: true, prefilled };
  }

  // 産休の手続きから続けて始めたときは、生まれた子と、産休の翌日からの期間を入れておく
  let period: LeavePeriodState | null = null;
  let child: LeaveProcedureState['child'] = null;
  if (input.kind === 'childcare' && input.sourceProcedureId) {
    const src = (await db.doc(`${base}/procedures/${input.sourceProcedureId}`).get()).data() as ProcedureDoc | undefined;
    const sp = src?.leaveProcedure;
    if (src && src.employeeId === input.employeeId && sp?.kind === 'maternity' && sp.period) {
      const birth = sp.period.actualBirthDate ?? sp.expectedBirthDate!;
      child = { lastName: employee.lastName, firstName: '', birthDate: birth, bornByEmployee: true };
      period = {
        startDate: addDays(sp.period.actualEndDate ?? sp.period.plannedEnd, 1), plannedEnd: childcareLimits(birth)[0].until,
        actualBirthDate: null, actualEndDate: null,
      };
    }
  }

  // 本人からの申請から始めたときは、申請の出産予定日・子・期間を入れておく（担当者がウィザードで確かめて直す）
  let expectedBirthDate: string | null = null;
  if (input.sourceRequestId) {
    const { leaveStateFromRequest, loadRequestForHandoff } = await import('../portal/handoff');
    const req = await loadRequestForHandoff(auth.companyId, input.sourceRequestId, input.employeeId, ['leave']);
    if (req.detail.kind !== input.kind) throw invalidArg('申請の休業の種類と違います');
    const s = leaveStateFromRequest(input.kind, req.detail);
    expectedBirthDate = s.expectedBirthDate;
    child = s.child ?? child;
    period = s.period ?? period;
  }

  const name = nameOf(employee);
  const now = Timestamp.now();
  const ref = db.collection(`${base}/procedures`).doc();
  const steps = buildLeaveWizardSteps();
  const batch = db.batch();
  batch.set(ref, {
    procedureType: input.kind === 'maternity' ? 'maternity_leave' : 'childcare_leave',
    title: `${name} ${SHORT[input.kind]}の手続き`, priority: 'normal', status: 'in_progress', statusReason: statusReasonOf(steps),
    employeeId: input.employeeId, employeeName: name, officeId: employee.officeId, targetOfficeId: null, scope: 'individual',
    batchMeta: null, invitationId: null, onboardToken: null, steps, deadline: null, effectiveDate: null,
    assignedTo: auth.uid, createdBy: auth.uid, references: [], notes: '', version: 1,
    createdAt: now, updatedAt: now, completedAt: null, deletedAt: null,
    leaveProcedure: {
      kind: input.kind, expectedBirthDate, multiple: false, child, period,
      filingKind: 'start', filingId: null, startFilingId: null, filedWithBirth: false, pending: null, history: [],
      leaveId: null, exemptionId: null, sourceProcedureId: input.sourceProcedureId,
    },
  } satisfies ProcedureDoc);
  batch.set(db.collection(`${base}/auditLogs`).doc(), {
    entity: 'procedure', entityId: ref.id, action: 'create', changes: { procedureType: { from: null, to: `${input.kind}_leave` } },
    performedBy: auth.uid, performedAt: now, version: 1,
  });
  await batch.commit();
  return { procedureId: ref.id, existing: false, prefilled: !!input.sourceRequestId };
}

// ── 読み取り ────────────────────────────────────────

async function loadProcedure(companyId: string, procedureId: string, auth: AuthContext) {
  const ref = db.doc(`companies/${companyId}/procedures/${procedureId}`);
  const snap = await ref.get();
  if (!snap.exists) throw notFound('手続き');
  const proc = snap.data() as ProcedureDoc;
  requireProcedureAccess(auth, proc);
  if (!proc.leaveProcedure || !proc.employeeId) throw invalidArg('この手続きは産休・育休の画面では扱えません');
  return { ref, proc: proc as LeaveProc };
}

export type LeaveStepKey = 'plan' | 'filing' | 'approval' | 'submit' | 'during' | 'confirm' | 'done';

export function currentLeaveStep(proc: ProcedureDoc): LeaveStepKey {
  if (proc.status === 'completed') return 'done';
  const s = (id: string) => stepOf(proc, id);
  if (s('plan').status !== 'completed') return 'plan';
  if (s('filing_create').status !== 'completed') return 'filing';
  if (s('approval').status !== 'completed') return 'approval';
  if (s('mock_filing').status !== 'completed' && s('paper_submit').status !== 'completed') return 'submit';
  if (s('during').status !== 'completed') return 'during';
  return 'confirm';
}

/** 期間の判定。入れかけの内容（画面）でも、保存済みの内容でも同じ関数を通す */
function planOf(kind: Kind, f: {
  expectedBirthDate: string; actualBirthDate: string; multiple: boolean; childBirthDate: string; bornByEmployee: boolean; startDate: string; endDate: string;
}) {
  if (kind === 'maternity') {
    if (!f.expectedBirthDate) return null;
    const p = planMaternity({ expectedBirthDate: f.expectedBirthDate, actualBirthDate: f.actualBirthDate || null, multiple: f.multiple, startDate: f.startDate });
    return { ...p, stage: null as string | null, notes: [] as string[] };
  }
  if (!f.childBirthDate || !f.startDate) return null;
  const p = planChildcare({ childBirthDate: f.childBirthDate, startDate: f.startDate, endDate: f.endDate, bornByEmployee: f.bornByEmployee });
  return { ...p, legalStart: null as string | null };
}

function savedPlan(lp: LeaveProcedureState) {
  if (!lp.period) return null;
  return planOf(lp.kind, {
    expectedBirthDate: lp.expectedBirthDate ?? '', actualBirthDate: lp.period.actualBirthDate ?? '', multiple: lp.multiple,
    childBirthDate: lp.child?.birthDate ?? '', bornByEmployee: lp.child?.bornByEmployee ?? false,
    startDate: lp.period.startDate, endDate: lp.period.plannedEnd,
  });
}

/** 休業中に起きたことの判定に使う、届け出た内容 */
function factsOf(lp: LeaveProcedureState, period: LeavePeriodState): LeaveFacts {
  return {
    kind: lp.kind, start: period.startDate, plannedEnd: period.plannedEnd, expectedBirthDate: lp.expectedBirthDate,
    actualBirthDate: period.actualBirthDate, multiple: lp.multiple, childBirthDate: lp.child?.birthDate ?? null, filedWithBirth: lp.filedWithBirth,
  };
}

/** 今の期間（終えた日があればその日まで）の免除される月 */
function currentExemption(lp: LeaveProcedureState) {
  if (!lp.period) return { exemptMonths: [] as string[], bonusExempt: false };
  if (!lp.period.actualEndDate) {
    const p = savedPlan(lp);
    return { exemptMonths: p?.exemptMonths ?? [], bonusExempt: p?.bonusExempt ?? false };
  }
  // 終えた日は judgeLeaveEvent で確かめ済み。期間を縮めて数え直す
  const j = judgeLeaveEvent(factsOf(lp, { ...lp.period, actualEndDate: null }), { type: 'end', date: lp.period.actualEndDate });
  return { exemptMonths: j.exemptMonths, bonusExempt: j.bonusExempt };
}

async function filingLocked(companyId: string, proc: LeaveProc) {
  const empPath = `companies/${companyId}/employees/${proc.employeeId}`;
  if (proc.leaveProcedure.filingId) {
    const f = await db.doc(`${empPath}/filings/${proc.leaveProcedure.filingId}`).get();
    if (f.exists && f.data()!.workflowStatus === 'approved') return true;
  }
  const approvalId = latestApprovalId(proc);
  if (!approvalId) return false;
  const a = await db.doc(`${empPath}/approvalRequests/${approvalId}`).get();
  return a.exists && a.data()!.status === 'pending';
}

/**
 * 申出書が承認されたら、免除を有効にする（カタログ：届出の承認で保険料計算に反映）。
 * 毎月の計算は承認済みの届出を直接見るので、ここを通らなくても免除は効く。画面と記録を合わせるために書く
 */
async function activateExemption(companyId: string, proc: LeaveProc, uid: string) {
  const lp = proc.leaveProcedure;
  if (!lp.exemptionId || !lp.startFilingId) return null;
  const empPath = `companies/${companyId}/employees/${proc.employeeId}`;
  const exRef = db.doc(`${empPath}/premiumExemptions/${lp.exemptionId}`);
  const [ex, filing] = await Promise.all([exRef.get(), db.doc(`${empPath}/filings/${lp.startFilingId}`).get()]);
  if (!ex.exists) return null;
  if (ex.data()!.status === 'pending' && filing.data()?.workflowStatus === 'approved') {
    const now = Timestamp.now();
    await exRef.update({ status: 'active', approvedAt: now, updatedAt: now, version: (ex.data()!.version ?? 1) + 1 });
    await db.collection(`companies/${companyId}/auditLogs`).doc().set({
      entity: 'premiumExemption', entityId: lp.exemptionId, action: 'update', changes: { status: { from: 'pending', to: 'active' } },
      note: `申出書の承認（手続き ${proc.employeeName}）`, performedBy: uid, performedAt: now, version: (ex.data()!.version ?? 1) + 1,
    });
    return { status: 'active', approvedAt: now.toDate().toISOString() };
  }
  return { status: ex.data()!.status as string, approvedAt: (ex.data()!.approvedAt as Timestamp | null)?.toDate().toISOString() ?? null };
}

/** 免除の月のうち、免除なしで計算済みの月（計算し直しが要る） */
async function recalcMonths(companyId: string, employeeId: string, months: string[]) {
  const today = todayJst().slice(0, 7);
  const targets = months.filter(m => m <= addMonths(today, 1));
  const snaps = await Promise.all(targets.map(m => db.doc(`companies/${companyId}/employees/${employeeId}/monthlyInsurance/${m}`).get()));
  return targets.filter((_, i) => snaps[i].exists && snaps[i].data()!.isExempted !== true);
}

export async function getLeave(companyId: string, procedureId: string, auth: AuthContext) {
  let { proc } = await loadProcedure(companyId, procedureId, auth);
  if (proc.status === 'in_progress' && proc.leaveProcedure.filingId) {
    proc = (await refreshProcedure(companyId, procedureId)).procedure as LeaveProc;
  }
  const lp = proc.leaveProcedure;
  const base = `companies/${companyId}`;
  const empPath = `${base}/employees/${proc.employeeId}`;
  const approvalId = latestApprovalId(proc);
  const [empSnap, office, filingSnap, approvalSnap, exemption] = await Promise.all([
    db.doc(empPath).get(),
    db.doc(`${base}/offices/${proc.officeId}`).get(),
    lp.filingId ? db.doc(`${empPath}/filings/${lp.filingId}`).get() : null,
    approvalId ? db.doc(`${empPath}/approvalRequests/${approvalId}`).get() : null,
    activateExemption(companyId, proc, auth.uid),
  ]);
  const e = empSnap.data() as EmployeeDoc;
  const filing = filingSnap?.exists ? filingSnap.data() as FilingDoc : null;
  const ex = currentExemption(lp);
  const end = lp.period ? lp.period.actualEndDate ?? lp.period.plannedEnd : null;
  return {
    procedure: {
      id: procedureId, version: proc.version, status: proc.status, title: proc.title, kind: lp.kind, kindLabel: KIND_LABEL[lp.kind],
      officeId: proc.officeId, officeName: (office.data()?.name as string) ?? '', employeeName: proc.employeeName,
      fromMaternity: lp.sourceProcedureId !== null,
    },
    current: currentLeaveStep(proc),
    steps: proc.steps.map(s => ({ id: s.id, label: s.label, status: s.status, statusDetail: s.statusDetail })),
    employee: { id: proc.employeeId!, employeeNumber: e.employeeNumber, name: nameOf(e), gender: e.gender },
    expectedBirthDate: lp.expectedBirthDate, multiple: lp.multiple, child: lp.child, period: lp.period,
    plan: savedPlan(lp),
    exemptMonths: ex.exemptMonths, bonusExempt: ex.bonusExempt,
    filingKind: lp.filingKind, filingLabel: FILING_LABEL[lp.kind][lp.filingKind],
    // 記録したが届出をまだ出していないこと（記録をやり直せる）
    pending: lp.pending && !submittedStep(proc) ? { type: lp.pending.type, date: lp.pending.date } : null,
    history: lp.history,
    filing: filing && lp.filingId ? {
      id: lp.filingId, version: filing.version, workflowStatus: filing.workflowStatus,
      mockStatus: filing.mockStatus, submissionStatus: filing.submissionStatus, resultNote: filing.resultNote,
    } : null,
    approval: approvalSnap?.exists ? { status: approvalSnap.data()!.status as string, comment: (approvalSnap.data()!.comment ?? null) as string | null } : null,
    locked: await filingLocked(companyId, proc),
    exemption,
    recalcMonths: exemption?.status === 'active' ? await recalcMonths(companyId, proc.employeeId!, ex.exemptMonths) : [],
    deadline: proc.deadline ? toDateString(proc.deadline) : null,
    /** 終了時改定の起点（休業を終えて戻った月）。終えるまでは予定 */
    returnMonth: end ? returnMonth(end) : null,
  };
}

// ── 期間 ────────────────────────────────────────────

export async function previewLeave(input: PreviewInput, auth: AuthContext) {
  const { proc } = await loadProcedure(input.companyId, input.procedureId, auth);
  const lp = proc.leaveProcedure;
  if (input.event) {
    const period = lp.pending && !submittedStep(proc) ? lp.pending.before : lp.period;
    if (!period) throw invalidArg('先に休業の期間を決めてください');
    return { event: judgeLeaveEvent(factsOf(lp, period), input.event), plan: null };
  }
  return { event: null, plan: planOf(lp.kind, input) };
}

/** 申出書がもう出せない（承認済み・承認待ち）なら、期間は直せない */
async function startFilingFixed(companyId: string, proc: LeaveProc) {
  const lp = proc.leaveProcedure;
  if (!lp.startFilingId) return false;
  if (lp.filingKind !== 'start') return true;
  return filingLocked(companyId, proc);
}

export async function savePlan(input: PlanInput, auth: AuthContext) {
  const { ref, proc } = await loadProcedure(input.companyId, input.procedureId, auth);
  requireVersion(proc, input.expectedVersion);
  const lp = proc.leaveProcedure;
  if (await startFilingFixed(input.companyId, proc)) {
    throw invalidArg('申出書の承認を申請済みです。休業中に変わったことは「休業中のことと復帰を記録する」で入れてください');
  }
  if (lp.kind === 'maternity' && !input.expectedBirthDate) throw invalidArg('出産予定日を入れてください');
  if (lp.kind === 'childcare') {
    if (!input.childLastName || !input.childFirstName) throw invalidArg('養育する子の氏名を入れてください');
    if (!input.childBirthDate) throw invalidArg('子の生年月日を入れてください');
    if (!input.startDate) throw invalidArg('育休を始める日を入れてください');
  }
  if (input.actualBirthDate && input.actualBirthDate > todayJst()) throw invalidArg('出産日に未来の日は入れられません。生まれる前は出産予定日だけを入れてください');
  const plan = planOf(lp.kind, input)!;
  if (plan.errors.length) throw invalidArg(plan.errors.join('。'));
  const period: LeavePeriodState = {
    startDate: plan.start, plannedEnd: plan.end,
    actualBirthDate: lp.kind === 'maternity' ? input.actualBirthDate || null : null, actualEndDate: null,
  };

  await db.runTransaction(async tx => {
    const latest = (await tx.get(ref)).data() as LeaveProc;
    requireVersion(latest, input.expectedVersion);
    const now = Timestamp.now();
    let steps = setStep(latest.steps, 'plan', { ...completed(auth.uid), statusDetail: `${plan.start}〜${plan.end}` });
    // 入れ直したら申出書は作り直す
    steps = resetFilingSteps(steps);
    tx.update(ref, {
      'leaveProcedure.expectedBirthDate': lp.kind === 'maternity' ? input.expectedBirthDate : null,
      'leaveProcedure.multiple': lp.kind === 'maternity' ? input.multiple : false,
      'leaveProcedure.child': lp.kind === 'childcare'
        ? { lastName: input.childLastName, firstName: input.childFirstName, birthDate: input.childBirthDate, bornByEmployee: input.bornByEmployee }
        : null,
      'leaveProcedure.period': period,
      references: latest.references.filter(r => r.type !== 'approval'),
      steps, statusReason: statusReasonOf(steps),
      deadline: plan.deadline ? toTimestamp(plan.deadline) : null,
      effectiveDate: toTimestamp(plan.start),
      version: latest.version + 1, updatedAt: now,
    });
  });
  return { success: true };
}

function resetFilingSteps(steps: ProcedureStep[]) {
  const clear = { referenceType: null, referenceId: null, referenceStatus: null, completedAt: null, completedBy: null, statusDetail: null, actionLabel: null, actionRoute: null };
  let s = setStep(steps, 'filing_create', { ...clear, status: 'available' });
  for (const id of ['approval', 'mock_filing', 'paper_submit']) s = setStep(s, id, { ...clear, status: 'blocked' });
  return setStep(s, 'confirm', { status: 'blocked', completedAt: null, completedBy: null });
}

// ── 申出書・変更届・終了届と承認 ───────────────────────────

function formDataOf(proc: LeaveProc, e: EmployeeDoc, office: OfficeDoc, kind: LeaveFilingKind) {
  const lp = proc.leaveProcedure;
  const p = lp.period!;
  const ex = currentExemption(lp);
  const common = {
    '事業所整理記号': office.officeNumber ?? '',
    '事業所名称': office.name ?? '',
    '被保険者整理番号': e.insuredPersonNumber ?? '',
    '被保険者氏名': nameOf(e),
    '被保険者氏名フリガナ': `${e.lastNameKana} ${e.firstNameKana}`,
    '生年月日': e.birthDate ? toDateString(e.birthDate) : '',
    '性別': e.gender === 'male' ? '男' : '女',
    '個人番号': '',
    '基礎年金番号': '',
    '届出区分': FILING_LABEL[lp.kind][kind],
    '免除される月': ex.exemptMonths.join('、'),
  };
  const before = lp.pending?.before;
  if (lp.kind === 'maternity') {
    return {
      ...common,
      '出産予定年月日': lp.expectedBirthDate,
      '出産種別': lp.multiple ? '多胎' : '単胎',
      '産前産後休業開始年月日': p.startDate,
      '産前産後休業終了予定年月日': p.plannedEnd,
      '出産年月日': p.actualBirthDate ?? '',
      ...(kind === 'change' ? { '変更の内容': '出産日が予定日と異なった', '変更前の終了予定年月日': before?.plannedEnd ?? '' } : {}),
      ...(kind === 'end' ? { '産前産後休業終了年月日': p.actualEndDate ?? '' } : {}),
      '備考': '',
    };
  }
  const c = lp.child!;
  return {
    ...common,
    '養育する子の氏名': `${c.lastName} ${c.firstName}`,
    '養育する子の生年月日': c.birthDate,
    '区分': kind === 'start' ? '新規' : kind === 'extend' ? '延長' : '終了',
    '育児休業等開始年月日': p.startDate,
    '育児休業等終了予定年月日': p.plannedEnd,
    ...(kind === 'extend' ? { '変更前の終了予定年月日': before?.plannedEnd ?? '' } : {}),
    ...(kind === 'end' ? { '育児休業等終了年月日': p.actualEndDate ?? '' } : {}),
    '備考': '',
  };
}

/** 休業の状態（leaves）。毎月の計算は開始・終了日から免除の月を決める */
function leaveFields(lp: LeaveProcedureState) {
  const p = lp.period!;
  const today = todayJst();
  return {
    leaveType: lp.kind, expectedStartDate: p.startDate, expectedEndDate: p.plannedEnd,
    actualStartDate: p.startDate <= today ? p.startDate : null, actualEndDate: p.actualEndDate,
    status: p.actualEndDate ? 'ended' : p.startDate <= today ? 'active' : 'planned',
  };
}

function exemptionRange(lp: LeaveProcedureState) {
  const months = currentExemption(lp).exemptMonths;
  return { startMonth: months[0] ?? lp.period!.startDate.slice(0, 7), endMonth: months.at(-1) ?? lp.period!.startDate.slice(0, 7) };
}

/** 休業と免除の記録を作る・直す（申出書を作ったとき、休業中のことを記録したとき） */
async function writeLeaveRecords(companyId: string, procedureId: string, proc: LeaveProc, lp: LeaveProcedureState, uid: string, filingId: string | null) {
  const empPath = `companies/${companyId}/employees/${proc.employeeId}`;
  const now = Timestamp.now();
  const batch = db.batch();
  const leaveRef = lp.leaveId ? db.doc(`${empPath}/leaves/${lp.leaveId}`) : db.collection(`${empPath}/leaves`).doc();
  const exRef = lp.exemptionId ? db.doc(`${empPath}/premiumExemptions/${lp.exemptionId}`) : db.collection(`${empPath}/premiumExemptions`).doc();
  if (lp.leaveId) batch.update(leaveRef, { ...leaveFields(lp), updatedAt: now });
  else batch.set(leaveRef, { ...leaveFields(lp), notes: '', procedureId, createdBy: uid, createdAt: now, updatedAt: now, version: 1 });
  if (lp.exemptionId) batch.update(exRef, { ...exemptionRange(lp), updatedAt: now });
  else {
    batch.set(exRef, {
      exemptionType: lp.kind, ...exemptionRange(lp), approvedAt: null, status: 'pending',
      // 月々・賞与のどちらを免除するかは、休業の期間から毎月の計算が判定する
      isMonthlyExempted: true, isBonusExempted: true, leaveId: leaveRef.id, filingId,
      notes: `${KIND_LABEL[lp.kind]}の申出書の承認で有効になります`, deletedAt: null, createdAt: now, updatedAt: now, version: 1,
    });
  }
  batch.set(db.collection(`companies/${companyId}/auditLogs`).doc(), {
    entity: 'leave', entityId: leaveRef.id, action: lp.leaveId ? 'update' : 'create',
    changes: { period: { from: null, to: `${lp.period!.startDate}〜${lp.period!.actualEndDate ?? lp.period!.plannedEnd}` }, exemption: { from: null, to: exRef.id } },
    performedBy: uid, performedAt: now, version: 1,
  });
  await batch.commit();
  return { leaveId: leaveRef.id, exemptionId: exRef.id };
}

export async function submitLeaveFiling(input: { companyId: string; procedureId: string; expectedVersion: number }, auth: AuthContext) {
  const { ref, proc } = await loadProcedure(input.companyId, input.procedureId, auth);
  requireVersion(proc, input.expectedVersion);
  const lp = proc.leaveProcedure;
  if (stepOf(proc, 'plan').status !== 'completed' || !lp.period) throw invalidArg('先に休業の期間を決めてください');
  if (await filingLocked(input.companyId, proc)) throw invalidArg('届出は承認を申請済みです');

  const base = `companies/${input.companyId}`;
  const empPath = `${base}/employees/${proc.employeeId}`;
  const [empSnap, officeSnap] = await Promise.all([db.doc(empPath).get(), db.doc(`${base}/offices/${proc.officeId}`).get()]);
  const e = empSnap.data() as EmployeeDoc;
  const office = (officeSnap.data() ?? {}) as OfficeDoc;
  const kind = lp.filingKind;
  // 画面の値は使わず、保存済みの内容からサーバーで作る
  const formData = formDataOf(proc, e, office, kind);
  const effectiveDate = kind === 'end' ? lp.period.actualEndDate! : lp.period.startDate;

  const now = Timestamp.now();
  const filings = db.collection(`${empPath}/filings`);
  const existing = lp.filingId ? await filings.doc(lp.filingId).get() : null;
  const filingRef = existing?.exists ? existing.ref : filings.doc();
  let filingVersion = 1;
  if (existing?.exists) {
    filingVersion = (existing.data()!.version as number) + 1;
    // 記録のやり直しで届出の種類が変わることがある（延長→終了など）
    await filingRef.update({ filingType: FILING_TYPE[lp.kind][kind], formData, workflowStatus: 'draft', effectiveDate, version: filingVersion, updatedAt: now });
  } else {
    await filingRef.set({
      filingType: FILING_TYPE[lp.kind][kind], workflowStatus: 'draft', mockStatus: 'notStarted', submissionStatus: 'notSubmitted',
      effectiveDate, formData, submittedAt: null, resultReceivedAt: null, resultNote: null, version: 1, createdAt: now, updatedAt: now,
    } satisfies FilingDoc);
  }
  await db.collection(`${base}/auditLogs`).doc().set({
    entity: 'filing', entityId: filingRef.id, action: existing?.exists ? 'update' : 'create',
    changes: { source: { from: null, to: `leave:${kind}` } }, performedBy: auth.uid, performedAt: now, version: filingVersion,
  });
  const filingId = filingRef.id;
  // 申出書を作ったら休業と免除（承認待ち）を記録する。免除は申出書の承認で効く
  const records = kind === 'start' ? await writeLeaveRecords(input.companyId, input.procedureId, proc, lp, auth.uid, filingId) : null;

  await db.runTransaction(async tx => {
    const latest = (await tx.get(ref)).data() as LeaveProc;
    requireVersion(latest, input.expectedVersion);
    let steps = setStep(latest.steps, 'filing_create', {
      ...completed(auth.uid), label: `${FILING_LABEL[lp.kind][kind]}を作る`, referenceType: 'filing', referenceId: filingId, statusDetail: '作成済み',
    });
    steps = setStep(steps, 'approval', { status: 'blocked', referenceType: null, referenceId: null, referenceStatus: null, completedAt: null, completedBy: null });
    for (const id of ['mock_filing', 'paper_submit']) steps = setStep(steps, id, { referenceType: 'filing', referenceId: filingId });
    const references = [
      ...latest.references.filter(r => r.type !== 'filing' && r.type !== 'approval'),
      { type: 'filing' as const, documentId: filingId, employeeId: proc.employeeId, documentSubtype: FILING_TYPE[lp.kind][kind], stepId: 'filing_create', createdAt: now },
    ];
    tx.update(ref, {
      'leaveProcedure.filingId': filingId,
      ...(kind === 'start' ? {
        'leaveProcedure.startFilingId': filingId, 'leaveProcedure.filedWithBirth': lp.period!.actualBirthDate !== null,
        'leaveProcedure.leaveId': records!.leaveId, 'leaveProcedure.exemptionId': records!.exemptionId,
      } : {}),
      steps, references, version: latest.version + 1, updatedAt: now,
    });
  });

  const { id: requestId } = await createApprovalRequest({
    companyId: input.companyId,
    employeeId: proc.employeeId!,
    targetPath: `${empPath}/filings/${filingId}`,
    targetVersion: filingVersion,
    requestType: 'filing',
    comment: `${proc.employeeName}さんの${FILING_LABEL[lp.kind][kind]}：${lp.period.startDate}〜${lp.period.actualEndDate ?? lp.period.plannedEnd}`,
    metadata: { source: 'leaveProcedure', procedureId: input.procedureId },
  }, auth);
  await refreshProcedure(input.companyId, input.procedureId);
  return { success: true, filingId, requestId };
}

// ── 休業中のこと（出産・延長・復帰） ───────────────────────

const submittedStep = (proc: ProcedureDoc) => stepOf(proc, 'mock_filing').status === 'completed' || stepOf(proc, 'paper_submit').status === 'completed';

/**
 * 出産日・育休の延長・休業を終えた日を記録する。届出が要るときは、届出のステップを作り直して同じ手続きで出す。
 * まだ承認を依頼していない届出があれば、その記録をやり直せる（記録する前の状態に戻してから判定する）
 */
export async function recordLeaveEvent(input: { companyId: string; procedureId: string; expectedVersion: number; type: LeaveEventType; date: string }, auth: AuthContext) {
  const { ref, proc } = await loadProcedure(input.companyId, input.procedureId, auth);
  requireVersion(proc, input.expectedVersion);
  let lp = proc.leaveProcedure;
  if (!lp.period || !lp.startFilingId) throw invalidArg('先に申出書を出してください');
  const startApproved = (await db.doc(`companies/${input.companyId}/employees/${proc.employeeId}/filings/${lp.startFilingId}`).get()).data()?.workflowStatus === 'approved';
  if (!startApproved) throw invalidArg('申出書の承認が済んでから記録してください');
  // 延長は先の日（新しい終了予定日）を入れる。出産・終了は起きてから記録する
  if (input.type !== 'extend' && input.date > todayJst()) throw invalidArg('まだ来ていない日は記録できません');

  let steps = proc.steps;
  let references = proc.references;
  // やり直しのとき、承認を依頼する前の届出（下書き・差し戻し）を使い回す
  let draftFilingId: string | null = null;
  // 履歴に移す届出（今の届出）を出すきっかけになった日
  let currentEventDate = lp.pending?.date ?? null;
  const redo = lp.pending !== null && !submittedStep(proc);
  if (redo) {
    if (await filingLocked(input.companyId, proc)) throw invalidArg('この届出は承認を依頼済みです。記録を直す場合は承認者に差し戻してもらってください');
    // 記録する前の状態に戻す（最後に提出した届出を今の届出に戻し、履歴から外す）
    const last = lp.history.at(-1);
    draftFilingId = lp.filingId;
    currentEventDate = last?.eventDate ?? null;
    steps = lp.pending!.steps;
    references = lp.pending!.references;
    lp = { ...lp, period: lp.pending!.before, filingKind: last?.kind ?? 'start', filingId: last?.filingId ?? lp.startFilingId, history: lp.history.slice(0, -1) };
  } else if (!submittedStep(proc)) {
    throw invalidArg(`先に${FILING_LABEL[lp.kind][lp.filingKind]}を提出してください`);
  } else if (lp.period.actualEndDate) {
    throw invalidArg('休業を終えた日は記録済みです');
  }

  const before = lp.period!;
  const j = judgeLeaveEvent(factsOf(lp, before), { type: input.type, date: input.date });
  if (j.errors.length) throw invalidArg(j.errors.join('。'));
  const period: LeavePeriodState = {
    startDate: j.start,
    plannedEnd: input.type === 'end' ? before.plannedEnd : j.end,
    actualBirthDate: j.actualBirthDate,
    actualEndDate: input.type === 'end' ? input.date : null,
  };
  // 新しい届出を出すときは、提出が済んだ今の届出を履歴に残す
  const next: LeaveProcedureState = j.filing ? {
    ...lp, period, filingKind: j.filing, filingId: draftFilingId,
    pending: { type: input.type, date: input.date, before, steps, references },
    history: [...lp.history, { kind: lp.filingKind, filingId: lp.filingId!, label: FILING_LABEL[lp.kind][lp.filingKind], eventDate: currentEventDate }],
  } : { ...lp, period, pending: null };

  let nextSteps = steps;
  let nextRefs = references;
  if (j.filing) {
    nextSteps = resetFilingSteps(nextSteps);
    nextRefs = nextRefs.filter(r => r.type !== 'filing' && r.type !== 'approval');
  }
  if (j.ended) {
    nextSteps = setStep(nextSteps, 'during', { ...completed(auth.uid), statusDetail: `${input.date}に${SHORT[lp.kind]}を終えた` });
  } else {
    const label = input.type === 'birth' ? `出産日 ${input.date}` : `${input.date}まで延長`;
    nextSteps = setStep(nextSteps, 'during', { statusDetail: label });
  }
  const deadline = lp.kind === 'maternity' && j.filing ? planMaternity({
    expectedBirthDate: lp.expectedBirthDate!, actualBirthDate: period.actualBirthDate, multiple: lp.multiple, startDate: period.startDate,
  }).deadline : null;

  await db.runTransaction(async tx => {
    const latest = (await tx.get(ref)).data() as LeaveProc;
    requireVersion(latest, input.expectedVersion);
    const now = Timestamp.now();
    tx.update(ref, {
      leaveProcedure: next, steps: nextSteps, references: nextRefs, statusReason: statusReasonOf(nextSteps),
      ...(j.filing ? { deadline: deadline ? toTimestamp(deadline) : null } : {}),
      version: latest.version + 1, updatedAt: now,
    });
    tx.set(db.collection(`companies/${input.companyId}/auditLogs`).doc(), {
      entity: 'procedure', entityId: input.procedureId, action: 'update',
      changes: { [`leave.${input.type}`]: { from: null, to: input.date } }, performedBy: auth.uid, performedAt: now, version: latest.version + 1,
    });
  });
  // やり直して届出が要らなくなったら、承認を依頼する前の届出は消す
  if (redo && !j.filing && draftFilingId) {
    await db.doc(`companies/${input.companyId}/employees/${proc.employeeId}/filings/${draftFilingId}`).delete();
  }
  // 休業と免除の期間を合わせる（早く終えれば免除の月も縮む）
  await writeLeaveRecords(input.companyId, input.procedureId, proc, next, auth.uid, lp.startFilingId);
  await refreshProcedure(input.companyId, input.procedureId);
  return { success: true, filing: j.filing, notes: j.notes };
}

// ── 完了 ────────────────────────────────────────────

export async function completeLeave(input: { companyId: string; procedureId: string; expectedVersion: number }, auth: AuthContext) {
  const { proc } = await loadProcedure(input.companyId, input.procedureId, auth);
  requireVersion(proc, input.expectedVersion);
  if (stepOf(proc, 'during').status !== 'completed') throw invalidArg('休業を終えた日を記録してから完了にしてください');
  if (stepOf(proc, 'confirm').status !== 'available') throw invalidArg('届出の提出が済んでから完了にしてください');
  await activateExemption(input.companyId, proc, auth.uid);
  return confirmProcedure({ procedureId: input.procedureId, stepId: 'confirm', expectedVersion: proc.version }, auth);
}
