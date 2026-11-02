import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../config';
import { AuthContext, requireOffice } from '../middleware/auth';
import {
  EmployeeDoc, EmploymentDoc, FilingDoc, GradeDoc, GradeRevisionDecision, GradeRevisionState, OfficeDoc, ProcedureDoc, ProcedureStep, SalaryDoc,
} from '../types/firestore';
import { invalidArg, notFound } from '../utils/errors';
import { toDateString } from '../utils/firestore';
import { normalizeEmployment } from '../utils/employment';
import { findApplicableRate } from '../utils/insurance-rate';
import { addDays, addMonths, resolveGradeTable } from '../insurance/calculator';
import { buildRevisionWizardSteps } from '../procedures/templates';
import { requireProcedureAccess } from '../procedures/access';
import { refreshProcedure } from '../procedures/refresh';
import { completed, latestApprovalId, requireVersion, setStep, statusReasonOf, stepOf, todayJst } from '../procedures/wizard';
import { createApprovalRequest } from '../approvals/approval-request-create/service';
import { confirmProcedure } from '../procedures/procedure-action/service';
import {
  CurrentGrade, DETERMINATION, effectiveMonthOf, FILING_LABEL, FILING_TYPE, fixedWageChange, FixedWageResult, judgeRevision, KIND_LABEL,
  leaveEndCheck, LeaveEndCheck, leaveEndStartMonth, RevisionResult, revisionMonths, RevisionSalary,
} from './rules';
import { ChangeInput, RevisionPreviewInput } from './schema';

type RevisionProc = ProcedureDoc & { gradeRevision: GradeRevisionState };
type Kind = GradeRevisionState['kind'];

const nameOf = (e: { lastName: string; firstName: string }) => `${e.lastName} ${e.firstName}`;
const ym = (m: string) => `${Number(m.slice(0, 4))}年${Number(m.slice(5, 7))}月`;

// ── 開始 ────────────────────────────────────────────

export async function startRevision(input: { employeeId: string; kind: Kind; startMonth: string | null; sourceProcedureId: string | null }, auth: AuthContext) {
  const base = `companies/${auth.companyId}`;
  const empPath = `${base}/employees/${input.employeeId}`;
  const [empSnap, employmentSnap] = await Promise.all([
    db.doc(empPath).get(),
    db.collection(`${empPath}/employments`).orderBy('effectiveDate', 'desc').limit(1).get(),
  ]);
  if (!empSnap.exists || empSnap.data()!.deletedAt !== null) throw notFound('従業員');
  const employee = empSnap.data() as EmployeeDoc;
  requireOffice(auth, employee.officeId);
  if (!employee.isActive) throw invalidArg('退職した人の等級は見直せません');
  const employment = employmentSnap.empty ? null : normalizeEmployment(employmentSnap.docs[0].data() as EmploymentDoc);
  if (employment && !employment.healthInsuranceEnrolled && !employment.pensionEnrolled) {
    throw invalidArg('社会保険に加入していないため、標準報酬月額の改定はありません');
  }

  let kind = input.kind;
  let startMonth = input.startMonth;
  let leave: GradeRevisionState['leave'] = null;
  // 産休・育休の手続きから始めたときは、休業を終えた日と子を引き継ぐ
  if (input.sourceProcedureId) {
    const src = (await db.doc(`${base}/procedures/${input.sourceProcedureId}`).get()).data() as ProcedureDoc | undefined;
    const lp = src?.leaveProcedure;
    if (!src || src.employeeId !== input.employeeId || !lp) throw invalidArg('引き継ぐ産休・育休の手続きが見つかりません');
    kind = lp.kind === 'maternity' ? 'maternityEnd' : 'childcareEnd';
    const endDate = lp.period?.actualEndDate ?? null;
    const childBirthDate = lp.kind === 'maternity' ? lp.period?.actualBirthDate ?? lp.expectedBirthDate : lp.child?.birthDate ?? null;
    const childName = lp.kind === 'childcare' && lp.child ? `${lp.child.lastName} ${lp.child.firstName}` : '';
    leave = {
      procedureId: input.sourceProcedureId, endDate, childName, childBirthDate,
      nextLeaveFromNextDay: endDate ? await nextLeaveStarts(auth.companyId, input.employeeId, endDate) : false,
      applied: false, appliedDate: null,
    };
    startMonth = endDate ? leaveEndStartMonth(endDate) : null;
  } else if (kind !== 'occasional') {
    leave = { procedureId: null, endDate: null, childName: '', childBirthDate: null, nextLeaveFromNextDay: false, applied: false, appliedDate: null };
    startMonth = null;
  }

  // 同じ人の進行中の同じ改定があれば、それを開く（二重に始めない）
  const existing = await db.collection(`${base}/procedures`).where('employeeId', '==', input.employeeId).where('deletedAt', '==', null).get();
  const open = existing.docs.find(d => {
    const p = d.data() as ProcedureDoc;
    const gr = p.gradeRevision;
    if (!gr || p.status !== 'in_progress' || gr.kind !== kind) return false;
    if (kind === 'occasional') return !startMonth || !gr.startMonth || gr.startMonth === startMonth;
    return !input.sourceProcedureId || gr.leave?.procedureId === input.sourceProcedureId;
  });
  if (open) return { procedureId: open.id, existing: true };

  const name = nameOf(employee);
  const now = Timestamp.now();
  const ref = db.collection(`${base}/procedures`).doc();
  const steps = buildRevisionWizardSteps();
  const batch = db.batch();
  batch.set(ref, {
    procedureType: 'monthly_change',
    title: `${name} ${KIND_LABEL[kind]}`, priority: 'normal', status: 'in_progress', statusReason: statusReasonOf(steps),
    employeeId: input.employeeId, employeeName: name, officeId: employee.officeId, targetOfficeId: null, scope: 'individual',
    batchMeta: null, invitationId: null, onboardToken: null, steps, deadline: null, effectiveDate: null,
    assignedTo: auth.uid, createdBy: auth.uid, references: [], notes: '', version: 1,
    createdAt: now, updatedAt: now, completedAt: null, deletedAt: null,
    gradeRevision: {
      kind, startMonth, manualDirection: null, previousRemuneration: null, note: '', leave,
      decision: null, filingId: null, closedReason: null,
    },
  } satisfies ProcedureDoc);
  batch.set(db.collection(`${base}/auditLogs`).doc(), {
    entity: 'procedure', entityId: ref.id, action: 'create', changes: { procedureType: { from: null, to: `monthly_change:${kind}` } },
    performedBy: auth.uid, performedAt: now, version: 1,
  });
  await batch.commit();
  return { procedureId: ref.id, existing: false };
}

/** 休業を終えた翌日から、続けて産休・育休の手続きがあるか */
async function nextLeaveStarts(companyId: string, employeeId: string, endDate: string) {
  const next = addDays(endDate, 1);
  const snap = await db.collection(`companies/${companyId}/procedures`).where('employeeId', '==', employeeId).where('deletedAt', '==', null).get();
  return snap.docs.some(d => {
    const p = d.data() as ProcedureDoc;
    return p.status !== 'cancelled' && p.leaveProcedure?.period?.startDate === next;
  });
}

// ── 読み取りと判定 ────────────────────────────────────

async function loadProcedure(companyId: string, procedureId: string, auth: AuthContext) {
  const ref = db.doc(`companies/${companyId}/procedures/${procedureId}`);
  const snap = await ref.get();
  if (!snap.exists) throw notFound('手続き');
  const proc = snap.data() as ProcedureDoc;
  requireProcedureAccess(auth, proc);
  if (!proc.gradeRevision || !proc.employeeId) throw invalidArg('この手続きは等級の見直しの画面では扱えません');
  return { ref, proc: proc as RevisionProc };
}

export type RevisionStepKey = 'change' | 'judge' | 'filing' | 'approval' | 'submit' | 'confirm' | 'done';

export function currentRevisionStep(proc: ProcedureDoc): RevisionStepKey {
  if (proc.status === 'completed') return 'done';
  const s = (id: string) => stepOf(proc, id);
  if (s('change').status !== 'completed') return 'change';
  if (s('judge').status !== 'completed') return 'judge';
  if (s('filing_create').status !== 'completed') return 'filing';
  if (s('approval').status !== 'completed') return 'approval';
  if (s('mock_filing').status !== 'completed' && s('paper_submit').status !== 'completed') return 'submit';
  return 'confirm';
}

/** 判定に使う入力（保存済みの状態、または入れかけの画面の値） */
interface ChangeForm {
  startMonth: string | null;
  manualDirection: 'up' | 'down' | null;
  previousRemuneration: number | null;
  leave: GradeRevisionState['leave'];
}

function formOfState(gr: GradeRevisionState): ChangeForm {
  return { startMonth: gr.startMonth, manualDirection: gr.manualDirection, previousRemuneration: gr.previousRemuneration, leave: gr.leave };
}

function formOfInput(kind: Kind, i: RevisionPreviewInput | ChangeInput, current: GradeRevisionState): ChangeForm {
  const leave = kind === 'occasional' ? null : {
    procedureId: current.leave?.procedureId ?? null, endDate: i.endDate || null, childName: i.childName, childBirthDate: i.childBirthDate || null,
    nextLeaveFromNextDay: i.nextLeaveFromNextDay, applied: i.applied, appliedDate: i.appliedDate || null,
  };
  return {
    startMonth: kind === 'occasional' ? i.startMonth || null : leave?.endDate ? leaveEndStartMonth(leave.endDate) : null,
    manualDirection: i.manualDirection, previousRemuneration: i.previousRemuneration, leave,
  };
}

export interface Evaluation {
  startMonth: string | null;
  effectiveMonth: string | null;
  fixedWage: (FixedWageResult & { before: number | null; after: number | null; beforeMonth: string | null }) | null;
  leaveCheck: LeaveEndCheck | null;
  judgement: RevisionResult | null;
  /** 新しい等級を使い始める月に、ほかの決定の等級がすでにある */
  conflict: string | null;
}

/** 給与・等級・料率を読んで判定する（保存しない） */
export async function evaluate(companyId: string, employeeId: string, officeId: string, kind: Kind, form: ChangeForm): Promise<Evaluation> {
  const leaveCheck = form.leave && kind !== 'occasional'
    ? leaveEndCheck({ kind, endDate: form.leave.endDate, childBirthDate: form.leave.childBirthDate, nextLeaveFromNextDay: form.leave.nextLeaveFromNextDay, applied: form.leave.applied })
    : null;
  const start = form.startMonth;
  if (!start) return { startMonth: null, effectiveMonth: null, fixedWage: null, leaveCheck, judgement: null, conflict: null };

  const base = `companies/${companyId}`;
  const empPath = `${base}/employees/${employeeId}`;
  const effectiveMonth = effectiveMonthOf(start);
  const prev = addMonths(start, -1);
  const months = revisionMonths(start);
  const [salarySnaps, gradeSnap, conflictSnap, employmentSnap, officeSnap] = await Promise.all([
    Promise.all([prev, ...months].map(m => db.doc(`${empPath}/salaries/${m}`).get())),
    // 改定の前の等級（新しい等級を使い始める月の前月に適用されている等級）
    db.collection(`${empPath}/grades`).where('effectiveMonth', '<=', addMonths(effectiveMonth, -1)).orderBy('effectiveMonth', 'desc').limit(1).get(),
    db.doc(`${empPath}/grades/${effectiveMonth}`).get(),
    db.collection(`${empPath}/employments`).orderBy('effectiveDate', 'desc').limit(1).get(),
    db.doc(`${base}/offices/${officeId}`).get(),
  ]);
  const office = (officeSnap.data() ?? {}) as OfficeDoc;
  const [healthRate, pensionRate] = await Promise.all([
    findApplicableRate({ companyId, insuranceType: 'health', yearMonth: months[2], prefectureCode: office.prefectureCode, insurerId: office.insurerId }),
    findApplicableRate({ companyId, insuranceType: 'pension', yearMonth: months[2] }),
  ]);
  const employment = employmentSnap.empty ? null : normalizeEmployment(employmentSnap.docs[0].data() as EmploymentDoc);
  const salaries = salarySnaps.map(s => s.exists ? s.data() as SalaryDoc & { noPay?: boolean } : null);
  const toSalary = (s: (SalaryDoc & { noPay?: boolean }) | null, m: string): RevisionSalary | null => s ? {
    yearMonth: m, confirmed: s.isConfirmed === true, totalSalary: s.totalSalary ?? 0, inKind: s.inKindAmount ?? 0,
    retroactive: s.retroactivePay?.amount ?? 0, paymentBasisDays: s.noPay ? 0 : s.paymentBasisDays ?? 0,
  } : null;

  let fixedWage: Evaluation['fixedWage'] = null;
  if (kind === 'occasional') {
    const [p, cur] = salaries;
    // 前月の給与がなくても、給与の入力で前の固定的賃金を残していれば使う
    const before = p ? p.totalFixedWage ?? null : cur?.previousTotalFixedWage ?? null;
    const after = cur ? cur.totalFixedWage ?? null : null;
    fixedWage = { ...fixedWageChange({ before, after, manualDirection: form.manualDirection }), before, after, beforeMonth: p ? prev : null };
  }

  const g = gradeSnap.empty ? null : gradeSnap.docs[0].data() as GradeDoc;
  const current: CurrentGrade | null = g ? {
    effectiveMonth: g.effectiveMonth, healthGrade: g.healthGradeNumber, healthStandard: g.healthStandardRemuneration,
    pensionGrade: g.pensionGradeNumber, pensionStandard: g.pensionStandardRemuneration, basisRemuneration: g.basisRemuneration ?? null,
  } : null;
  const judgement = judgeRevision({
    kind, startMonth: start, salaries: months.map((m, i) => toSalary(salaries[i + 1], m)),
    insuredCategory: employment?.insuredCategory ?? 'general', current,
    direction: fixedWage?.direction ?? null, fixedWageUnchanged: fixedWage?.changed === false,
    enrolled: { health: employment?.healthInsuranceEnrolled ?? true, pension: employment?.pensionEnrolled ?? true },
    tables: { health: resolveGradeTable('health', healthRate?.gradeTable), pension: resolveGradeTable('pension', pensionRate?.gradeTable) },
    previousRemuneration: form.previousRemuneration,
    leaveEnd: leaveCheck ?? undefined,
  });
  // 終了時改定で入れてもらうものが残っていれば、判定の前に知らせる
  if (leaveCheck?.missing.length && judgement.status === 'ineligible') judgement.messages.push(...leaveCheck.missing.filter(m => !judgement.messages.includes(m)));

  let conflict: string | null = null;
  if (conflictSnap.exists) {
    const c = conflictSnap.data() as GradeDoc;
    const label: Record<string, string> = { regular: '定時決定', occasional: '随時改定', initial: '資格取得時決定', leaveEnd: '終了時改定', specific: 'その他の決定' };
    conflict = `${ym(effectiveMonth)}から使う等級は、すでに${label[c.determinationType] ?? '別の決定'}で決まっています（健保${c.healthGradeNumber}等級・厚年${c.pensionGradeNumber}等級）。同じ月に2つの決定はできません`;
  }
  return { startMonth: start, effectiveMonth, fixedWage, leaveCheck, judgement, conflict };
}

async function filingLocked(companyId: string, proc: RevisionProc) {
  const empPath = `companies/${companyId}/employees/${proc.employeeId}`;
  if (proc.gradeRevision.filingId) {
    const f = await db.doc(`${empPath}/filings/${proc.gradeRevision.filingId}`).get();
    if (f.exists && f.data()!.workflowStatus === 'approved') return true;
  }
  const approvalId = latestApprovalId(proc);
  if (!approvalId) return false;
  const a = await db.doc(`${empPath}/approvalRequests/${approvalId}`).get();
  return a.exists && a.data()!.status === 'pending';
}

/** 新しい等級を使う月のうち、改定の前の等級で保険料を計算済みの月（計算し直しが要る） */
async function recalcMonths(companyId: string, employeeId: string, d: GradeRevisionDecision) {
  const last = addMonths(todayJst().slice(0, 7), 1);
  const months: string[] = [];
  for (let m = d.effectiveMonth; m <= last && months.length < 24; m = addMonths(m, 1)) months.push(m);
  const snaps = await Promise.all(months.map(m => db.doc(`companies/${companyId}/employees/${employeeId}/monthlyInsurance/${m}`).get()));
  return months.filter((_, i) => {
    const p = snaps[i].data();
    if (!p) return false;
    return (d.health.eligible && p.healthGradeNumber !== d.health.newGrade) || (d.pension.eligible && p.pensionGradeNumber !== d.pension.newGrade);
  });
}

export async function getRevision(companyId: string, procedureId: string, auth: AuthContext) {
  let { proc } = await loadProcedure(companyId, procedureId, auth);
  if (proc.status === 'in_progress' && proc.gradeRevision.filingId) {
    proc = (await refreshProcedure(companyId, procedureId)).procedure as RevisionProc;
  }
  const gr = proc.gradeRevision;
  const base = `companies/${companyId}`;
  const empPath = `${base}/employees/${proc.employeeId}`;
  const approvalId = latestApprovalId(proc);
  const [empSnap, office, filingSnap, approvalSnap, ev] = await Promise.all([
    db.doc(empPath).get(),
    db.doc(`${base}/offices/${proc.officeId}`).get(),
    gr.filingId ? db.doc(`${empPath}/filings/${gr.filingId}`).get() : null,
    approvalId ? db.doc(`${empPath}/approvalRequests/${approvalId}`).get() : null,
    // 決めたあと（届出・承認・提出）と終えた手続きは、決めたときの判定を見せる
    proc.status === 'in_progress' ? evaluate(companyId, proc.employeeId!, proc.officeId, gr.kind, formOfState(gr)) : null,
  ]);
  const e = empSnap.data() as EmployeeDoc;
  const filing = filingSnap?.exists ? filingSnap.data() as FilingDoc : null;
  const approved = filing?.workflowStatus === 'approved';
  return {
    procedure: {
      id: procedureId, version: proc.version, status: proc.status, title: proc.title, kind: gr.kind, kindLabel: KIND_LABEL[gr.kind],
      officeId: proc.officeId, officeName: (office.data()?.name as string) ?? '', employeeName: proc.employeeName,
    },
    current: currentRevisionStep(proc),
    steps: proc.steps.map(s => ({ id: s.id, label: s.label, status: s.status, statusDetail: s.statusDetail })),
    employee: { id: proc.employeeId!, employeeNumber: e.employeeNumber, name: nameOf(e), otherEmployer: e.otherEmployer?.name ?? null },
    form: {
      startMonth: gr.startMonth, manualDirection: gr.manualDirection, previousRemuneration: gr.previousRemuneration, note: gr.note, leave: gr.leave,
    },
    evaluation: ev,
    decision: gr.decision ? { ...gr.decision, decidedAt: gr.decision.decidedAt.toDate().toISOString() } : null,
    closedReason: gr.closedReason,
    filingLabel: FILING_LABEL[gr.kind],
    filing: filing && gr.filingId ? {
      id: gr.filingId, version: filing.version, workflowStatus: filing.workflowStatus,
      mockStatus: filing.mockStatus, submissionStatus: filing.submissionStatus, resultNote: filing.resultNote,
    } : null,
    approval: approvalSnap?.exists ? { status: approvalSnap.data()!.status as string, comment: (approvalSnap.data()!.comment ?? null) as string | null } : null,
    locked: await filingLocked(companyId, proc),
    recalcMonths: approved && gr.decision ? await recalcMonths(companyId, proc.employeeId!, gr.decision) : [],
  };
}

export async function previewRevision(input: RevisionPreviewInput, auth: AuthContext) {
  const { proc } = await loadProcedure(input.companyId, input.procedureId, auth);
  const gr = proc.gradeRevision;
  return evaluate(input.companyId, proc.employeeId!, proc.officeId, gr.kind, formOfInput(gr.kind, input, gr));
}

// ── 変動を確かめる ──────────────────────────────────

function resetFrom(steps: ProcedureStep[], from: 'judge' | 'filing_create') {
  const clear = { referenceType: null, referenceId: null, referenceStatus: null, completedAt: null, completedBy: null, statusDetail: null, actionLabel: null, actionRoute: null };
  let s = steps;
  if (from === 'judge') s = setStep(s, 'judge', { ...clear, status: 'available' });
  s = setStep(s, 'filing_create', { ...clear, status: from === 'filing_create' ? 'available' : 'blocked' });
  for (const id of ['approval', 'mock_filing', 'paper_submit']) s = setStep(s, id, { ...clear, status: 'blocked' });
  return setStep(s, 'confirm', { status: 'blocked', completedAt: null, completedBy: null });
}

export async function saveChange(input: ChangeInput, auth: AuthContext) {
  const { ref, proc } = await loadProcedure(input.companyId, input.procedureId, auth);
  requireVersion(proc, input.expectedVersion);
  const gr = proc.gradeRevision;
  if (await filingLocked(input.companyId, proc)) throw invalidArg('届出の承認を依頼済みです。直す場合は承認者に差し戻してもらってください');
  const form = formOfInput(gr.kind, input, gr);
  if (gr.kind === 'occasional') {
    if (!form.startMonth) throw invalidArg('固定的賃金が変わった給与の支給月（変動月）を入れてください');
    if (form.startMonth > addMonths(todayJst().slice(0, 7), 1)) throw invalidArg('変動月は来月の支給月までにしてください。先の昇給は給与を払ってから判定します');
  } else {
    if (!form.leave?.endDate) throw invalidArg('休業を終えた日を入れてください');
    if (!form.leave.childBirthDate) throw invalidArg('養育する子の生年月日を入れてください');
    if (form.leave.applied && !form.leave.appliedDate) throw invalidArg('本人から申出を受けた日を入れてください');
  }
  const detail = gr.kind === 'occasional' ? `変動月 ${ym(form.startMonth!)}` : `${form.leave!.endDate}に休業を終えた（${ym(form.startMonth!)}から3か月）`;

  await db.runTransaction(async tx => {
    const latest = (await tx.get(ref)).data() as RevisionProc;
    requireVersion(latest, input.expectedVersion);
    const now = Timestamp.now();
    // 入れ直したら判定からやり直す
    let steps = setStep(latest.steps, 'change', { ...completed(auth.uid), statusDetail: detail });
    steps = resetFrom(steps, 'judge');
    tx.update(ref, {
      'gradeRevision.startMonth': form.startMonth,
      'gradeRevision.manualDirection': gr.kind === 'occasional' ? form.manualDirection : null,
      'gradeRevision.previousRemuneration': form.previousRemuneration,
      'gradeRevision.note': input.note,
      'gradeRevision.leave': form.leave,
      'gradeRevision.decision': null,
      references: latest.references.filter(r => r.type !== 'approval'),
      steps, statusReason: statusReasonOf(steps),
      effectiveDate: Timestamp.fromDate(new Date(`${effectiveMonthOf(form.startMonth!)}-01T00:00:00+09:00`)),
      version: latest.version + 1, updatedAt: now,
    });
  });
  return { success: true };
}

// ── 判定する ───────────────────────────────────────

function insuranceOf(r: RevisionResult['health']) {
  return { eligible: r.eligible, currentGrade: r.currentGrade, currentStandard: r.currentStandard, newGrade: r.newGrade, newStandard: r.newStandard };
}

function gradeText(d: Pick<GradeRevisionDecision, 'health' | 'pension'>) {
  const part = (label: string, x: GradeRevisionDecision['health']) =>
    x.eligible ? `${label}${x.currentGrade}→${x.newGrade}等級` : `${label}${x.currentGrade ?? '-'}等級のまま`;
  return `${part('健保', d.health)}・${part('厚年', d.pension)}`;
}

export async function decideRevision(input: { companyId: string; procedureId: string; expectedVersion: number; decision: 'revise' | 'close' }, auth: AuthContext) {
  const { ref, proc } = await loadProcedure(input.companyId, input.procedureId, auth);
  requireVersion(proc, input.expectedVersion);
  const gr = proc.gradeRevision;
  if (stepOf(proc, 'change').status !== 'completed') throw invalidArg('先に変動を確かめてください');
  if (await filingLocked(input.companyId, proc)) throw invalidArg('届出の承認を依頼済みです');
  const ev = await evaluate(input.companyId, proc.employeeId!, proc.officeId, gr.kind, formOfState(gr));
  const j = ev.judgement;
  if (!j) throw invalidArg('先に変動を確かめてください');
  const now = Timestamp.now();

  if (input.decision === 'close') {
    // 改定の対象なのに、改定せずに終えることはできない（随時改定は届け出る義務がある）
    if (j.status === 'eligible') throw invalidArg('改定の対象です。届出を作って進めてください');
    if (j.status === 'waiting') throw invalidArg('給与がそろっていないため、まだ決められません');
    const reason = j.messages.join('／') || '改定の対象ではありません';
    await db.runTransaction(async tx => {
      const latest = (await tx.get(ref)).data() as RevisionProc;
      requireVersion(latest, input.expectedVersion);
      let steps = setStep(latest.steps, 'judge', { ...completed(auth.uid), statusDetail: '改定しない' });
      for (const id of ['filing_create', 'approval', 'mock_filing', 'paper_submit']) steps = setStep(steps, id, { status: 'skipped', statusDetail: '改定しないため不要' });
      steps = setStep(steps, 'confirm', completed(auth.uid));
      tx.update(ref, {
        'gradeRevision.closedReason': reason,
        steps, status: 'completed', statusReason: `改定しない：${reason}`, completedAt: now,
        version: latest.version + 1, updatedAt: now,
      });
      tx.set(db.collection(`companies/${input.companyId}/auditLogs`).doc(), {
        entity: 'procedure', entityId: input.procedureId, action: 'update', changes: { gradeRevision: { from: null, to: `close:${reason}` } },
        performedBy: auth.uid, performedAt: now, version: latest.version + 1,
      });
    });
    return { success: true, closed: true };
  }

  if (ev.conflict) throw invalidArg(ev.conflict);
  if (j.status !== 'eligible') throw invalidArg(j.messages.join('。') || '改定の対象ではありません');
  const decision: GradeRevisionDecision = {
    startMonth: j.startMonth, effectiveMonth: j.effectiveMonth,
    months: j.months.map(m => ({
      yearMonth: m.yearMonth, totalSalary: m.totalSalary ?? 0, inKind: m.inKind ?? 0, retroactive: m.retroactive ?? 0,
      remuneration: m.remuneration ?? 0, paymentBasisDays: m.paymentBasisDays ?? 0, used: m.used,
    })),
    total: j.total!, average: j.average!, averageWithRetro: j.averageWithRetro!,
    direction: ev.fixedWage?.direction ?? null,
    health: insuranceOf(j.health), pension: insuranceOf(j.pension),
    decidedAt: now, decidedBy: auth.uid,
  };
  await db.runTransaction(async tx => {
    const latest = (await tx.get(ref)).data() as RevisionProc;
    requireVersion(latest, input.expectedVersion);
    let steps = setStep(latest.steps, 'judge', { ...completed(auth.uid), statusDetail: `${gradeText(decision)}（${ym(decision.effectiveMonth)}から）` });
    steps = resetFrom(steps, 'filing_create');
    tx.update(ref, {
      'gradeRevision.decision': decision,
      references: latest.references.filter(r => r.type !== 'approval'),
      steps, statusReason: statusReasonOf(steps),
      version: latest.version + 1, updatedAt: now,
    });
  });
  return { success: true, closed: false };
}

// ── 届出と承認 ─────────────────────────────────────

/** 届出の内容。月額変更届と終了時報酬月額変更届は同じ欄（3か月の報酬・平均・従前の等級）を持つ */
export function revisionFormData(kind: Kind, d: GradeRevisionDecision, e: EmployeeDoc, office: OfficeDoc, gr: GradeRevisionState) {
  const used = d.months.filter(m => m.used);
  const total = used.reduce((s, m) => s + m.totalSalary + m.inKind, 0);
  const hasRetro = d.months.some(m => m.retroactive > 0);
  const data: Record<string, unknown> = {
    '事業所整理記号': office.officeNumber ?? '',
    '事業所名称': office.name ?? '',
    '被保険者整理番号': e.insuredPersonNumber ?? '',
    '被保険者氏名': nameOf(e),
    '被保険者氏名フリガナ': `${e.lastNameKana} ${e.firstNameKana}`,
    '生年月日': e.birthDate ? toDateString(e.birthDate) : '',
    '個人番号': '',
    '基礎年金番号': e.basicPensionNumber ?? '',
    '届出区分': FILING_LABEL[kind],
    '改定年月': d.effectiveMonth,
    '従前の標準報酬月額_健康保険': d.health.currentStandard,
    '従前の等級_健康保険': d.health.currentGrade,
    '従前の標準報酬月額_厚生年金': d.pension.currentStandard,
    '従前の等級_厚生年金': d.pension.currentGrade,
    '改定後の標準報酬月額_健康保険': d.health.eligible ? d.health.newStandard : d.health.currentStandard,
    '改定後の等級_健康保険': d.health.eligible ? d.health.newGrade : d.health.currentGrade,
    '改定後の標準報酬月額_厚生年金': d.pension.eligible ? d.pension.newStandard : d.pension.currentStandard,
    '改定後の等級_厚生年金': d.pension.eligible ? d.pension.newGrade : d.pension.currentGrade,
    '改定する保険': [d.health.eligible ? '健康保険' : null, d.pension.eligible ? '厚生年金' : null].filter(Boolean).join('・'),
    '昇降給月': kind === 'occasional' ? d.startMonth : null,
    '昇降給区分': d.direction === 'up' ? '昇給' : d.direction === 'down' ? '降給' : null,
    '合計': total,
    '平均額': used.length ? Math.floor(total / used.length) : null,
    '修正平均額': hasRetro ? d.average : null,
    '遡及支払額': hasRetro ? d.months.reduce((s, m) => s + m.retroactive, 0) : null,
    '遡及支払月': hasRetro ? d.months.filter(m => m.retroactive > 0).map(m => m.yearMonth).join('、') : null,
    '備考': gr.note,
  };
  d.months.forEach((m, i) => {
    const p = `${i + 1}月目`;
    data[`${p}_年月`] = m.yearMonth;
    data[`${p}_支払基礎日数`] = m.paymentBasisDays;
    data[`${p}_通貨`] = m.totalSalary;
    data[`${p}_現物`] = m.inKind;
    data[`${p}_算入`] = m.used;
  });
  if (kind !== 'occasional' && gr.leave) {
    data['休業終了年月日'] = gr.leave.endDate;
    data['養育する子の氏名'] = gr.leave.childName;
    data['養育する子の生年月日'] = gr.leave.childBirthDate;
    data['申出年月日'] = gr.leave.appliedDate;
  }
  return data;
}

const sameDecision = (a: GradeRevisionDecision, j: RevisionResult) =>
  a.effectiveMonth === j.effectiveMonth && a.average === j.average
  && a.health.eligible === j.health.eligible && a.health.newGrade === j.health.newGrade
  && a.pension.eligible === j.pension.eligible && a.pension.newGrade === j.pension.newGrade;

export async function submitRevisionFiling(input: { companyId: string; procedureId: string; expectedVersion: number }, auth: AuthContext) {
  const { ref, proc } = await loadProcedure(input.companyId, input.procedureId, auth);
  requireVersion(proc, input.expectedVersion);
  const gr = proc.gradeRevision;
  const d = gr.decision;
  if (stepOf(proc, 'judge').status !== 'completed' || !d) throw invalidArg('先に判定して、改定すると決めてください');
  if (await filingLocked(input.companyId, proc)) throw invalidArg('届出は承認を申請済みです');
  // 決めたあとに給与や等級が変わっていないか、サーバーで判定し直して確かめる
  const ev = await evaluate(input.companyId, proc.employeeId!, proc.officeId, gr.kind, formOfState(gr));
  if (ev.conflict) throw invalidArg(ev.conflict);
  if (!ev.judgement || ev.judgement.status !== 'eligible' || !sameDecision(d, ev.judgement)) {
    throw invalidArg('決めたあとに給与や等級が変わりました。「判定する」で判定し直してください');
  }

  const base = `companies/${input.companyId}`;
  const empPath = `${base}/employees/${proc.employeeId}`;
  const [empSnap, officeSnap] = await Promise.all([db.doc(empPath).get(), db.doc(`${base}/offices/${proc.officeId}`).get()]);
  const e = empSnap.data() as EmployeeDoc;
  const office = (officeSnap.data() ?? {}) as OfficeDoc;
  const formData = revisionFormData(gr.kind, d, e, office, gr);
  const effectiveDate = `${d.effectiveMonth}-01`;
  const filingType = FILING_TYPE[gr.kind];

  const now = Timestamp.now();
  const filings = db.collection(`${empPath}/filings`);
  const existing = gr.filingId ? await filings.doc(gr.filingId).get() : null;
  const filingRef = existing?.exists ? existing.ref : filings.doc();
  let filingVersion = 1;
  if (existing?.exists) {
    filingVersion = (existing.data()!.version as number) + 1;
    await filingRef.update({ filingType, formData, workflowStatus: 'draft', effectiveDate, version: filingVersion, updatedAt: now });
  } else {
    await filingRef.set({
      filingType, workflowStatus: 'draft', mockStatus: 'notStarted', submissionStatus: 'notSubmitted',
      effectiveDate, formData, submittedAt: null, resultReceivedAt: null, resultNote: null, version: 1, createdAt: now, updatedAt: now,
    } satisfies FilingDoc);
  }
  await db.collection(`${base}/auditLogs`).doc().set({
    entity: 'filing', entityId: filingRef.id, action: existing?.exists ? 'update' : 'create',
    changes: { source: { from: null, to: `gradeRevision:${gr.kind}` } }, performedBy: auth.uid, performedAt: now, version: filingVersion,
  });
  const filingId = filingRef.id;

  await db.runTransaction(async tx => {
    const latest = (await tx.get(ref)).data() as RevisionProc;
    requireVersion(latest, input.expectedVersion);
    let steps = setStep(latest.steps, 'filing_create', {
      ...completed(auth.uid), label: `${FILING_LABEL[gr.kind]}を作る`, referenceType: 'filing', referenceId: filingId, statusDetail: '作成済み',
    });
    steps = setStep(steps, 'approval', { status: 'blocked', referenceType: null, referenceId: null, referenceStatus: null, completedAt: null, completedBy: null });
    for (const id of ['mock_filing', 'paper_submit']) steps = setStep(steps, id, { referenceType: 'filing', referenceId: filingId });
    const references = [
      ...latest.references.filter(r => r.type !== 'filing' && r.type !== 'approval'),
      { type: 'filing' as const, documentId: filingId, employeeId: proc.employeeId, documentSubtype: filingType, stepId: 'filing_create', createdAt: now },
    ];
    tx.update(ref, { 'gradeRevision.filingId': filingId, steps, references, version: latest.version + 1, updatedAt: now });
  });

  // 承認されると届出が承認済みになり、同時に新しい等級が確定する（入社の資格取得届と同じ仕組み）
  const label = KIND_LABEL[gr.kind];
  const { id: requestId } = await createApprovalRequest({
    companyId: input.companyId,
    employeeId: proc.employeeId!,
    targetPath: `${empPath}/filings/${filingId}`,
    targetVersion: filingVersion,
    requestType: 'filing',
    comment: `${proc.employeeName}さんの${FILING_LABEL[gr.kind]}：${gradeText(d)}（${ym(d.effectiveMonth)}から）`,
    metadata: {
      source: 'gradeRevision',
      procedureId: input.procedureId,
      grade: {
        path: `${empPath}/grades/${d.effectiveMonth}`,
        effectiveMonth: d.effectiveMonth,
        determinationType: DETERMINATION[gr.kind],
        healthGradeNumber: d.health.eligible ? d.health.newGrade : d.health.currentGrade,
        healthStandardRemuneration: d.health.eligible ? d.health.newStandard : d.health.currentStandard,
        pensionGradeNumber: d.pension.eligible ? d.pension.newGrade : d.pension.currentGrade,
        pensionStandardRemuneration: d.pension.eligible ? d.pension.newStandard : d.pension.currentStandard,
        basisRemuneration: d.average,
        basisMonths: d.months.filter(m => m.used).map(m => m.yearMonth),
        reason: `${label} 起点${ym(d.startMonth)} 平均${d.average.toLocaleString('ja-JP')}円`,
      },
    },
  }, auth);
  await refreshProcedure(input.companyId, input.procedureId);
  return { success: true, filingId, requestId };
}

// ── 完了 ────────────────────────────────────────────

export async function completeRevision(input: { companyId: string; procedureId: string; expectedVersion: number }, auth: AuthContext) {
  const { proc } = await loadProcedure(input.companyId, input.procedureId, auth);
  requireVersion(proc, input.expectedVersion);
  if (stepOf(proc, 'confirm').status !== 'available') throw invalidArg('届出の提出が済んでから完了にしてください');
  return confirmProcedure({ procedureId: input.procedureId, stepId: 'confirm', expectedVersion: proc.version }, auth);
}
