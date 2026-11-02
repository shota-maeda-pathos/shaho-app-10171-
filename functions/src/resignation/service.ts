import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../config';
import { AuthContext, requireOffice } from '../middleware/auth';
import {
  EmployeeDoc, EmploymentDoc, FilingDoc, GradeDoc, OfficeDoc, ProcedureDoc, ResignationState, UserDoc,
} from '../types/firestore';
import { invalidArg, notFound } from '../utils/errors';
import { toDateString, toTimestamp } from '../utils/firestore';
import { normalizeEmployment, qualificationDates } from '../utils/employment';
import { findAllRates } from '../utils/insurance-rate';
import { calculateChildSupportPayment } from '../utils/child-support-payment';
import { isHealthExcluded, isLongTermCareAge, isPensionExcluded } from '../utils/age';
import { addDays, ageReachDate, monthOf, normalizeRoundingRule, splitPremium } from '../insurance/calculator';
import { buildResignationSteps } from '../procedures/templates';
import { requireProcedureAccess } from '../procedures/access';
import { completed, isDone, latestApprovalId, requireVersion, setStep, statusReasonOf, stepOf, todayJst } from '../procedures/wizard';
import { refreshProcedure } from '../procedures/refresh';
import { createApprovalRequest } from '../approvals/approval-request-create/service';
import { confirmProcedure } from '../procedures/procedure-action/service';
import { LossReason, resignationFacts, ResignationFacts, settlementMonths, SettlementMonthInput, settlementPlan } from './rules';
import { EntryInput } from './schema';

/** 届出を出す場合だけ行うステップ */
const FILING_STEPS = ['filing_create', 'approval', 'mock_filing', 'paper_submit'];

type ResignationProcedure = ProcedureDoc & { resignation: ResignationState };

const nameOf = (e: EmployeeDoc) => `${e.lastName} ${e.firstName}`;
/** その日の終わり（東京）。閲覧期間の判定に使う */
const endOfDayJst = (date: string) => Timestamp.fromDate(new Date(`${addDays(date, 1)}T00:00:00+09:00`));

// ── 開始 ────────────────────────────────────────────

export async function startResignation(input: { employeeId: string }, auth: AuthContext) {
  const base = `companies/${auth.companyId}`;
  const empSnap = await db.doc(`${base}/employees/${input.employeeId}`).get();
  if (!empSnap.exists || empSnap.data()!.deletedAt !== null) throw notFound('従業員');
  const employee = empSnap.data() as EmployeeDoc;
  requireOffice(auth, employee.officeId);

  // 同じ人の進行中の退職手続きがあれば、それを開く（二重に始めない）
  const existing = await db.collection(`${base}/procedures`)
    .where('employeeId', '==', input.employeeId).where('deletedAt', '==', null).get();
  const open = existing.docs.find(d => {
    const p = d.data() as ProcedureDoc;
    return p.procedureType === 'loss' && p.resignation && (p.status === 'in_progress' || p.status === 'draft');
  });
  if (open) return { procedureId: open.id, existing: true };
  if (!employee.isActive || employee.resignationDate) throw invalidArg('この従業員はすでに退職済みです');

  const name = nameOf(employee);
  const now = Timestamp.now();
  const ref = db.collection(`${base}/procedures`).doc();
  const resignation: ResignationState = {
    resignationDate: null, reason: 'resignation', note: '', appliedAt: null,
    settlement: null, cards: null, filingId: null, accessUntil: null,
  };
  const steps = buildResignationSteps();
  const batch = db.batch();
  batch.set(ref, {
    procedureType: 'loss', title: `${name} 退職手続き`, priority: 'normal', status: 'in_progress', statusReason: statusReasonOf(steps),
    employeeId: input.employeeId, employeeName: name, officeId: employee.officeId, targetOfficeId: null, scope: 'individual',
    batchMeta: null, invitationId: null, onboardToken: null, steps, deadline: null, effectiveDate: null,
    assignedTo: auth.uid, createdBy: auth.uid, references: [], notes: '', version: 1,
    createdAt: now, updatedAt: now, completedAt: null, deletedAt: null, resignation,
  } satisfies ProcedureDoc);
  batch.set(db.collection(`${base}/auditLogs`).doc(), {
    entity: 'procedure', entityId: ref.id, action: 'create', changes: { procedureType: { from: null, to: 'loss' } },
    performedBy: auth.uid, performedAt: now, version: 1,
  });
  await batch.commit();
  return { procedureId: ref.id, existing: false };
}

// ── 読み取り ────────────────────────────────────────

async function loadProcedure(companyId: string, procedureId: string, auth: AuthContext) {
  const ref = db.doc(`companies/${companyId}/procedures/${procedureId}`);
  const snap = await ref.get();
  if (!snap.exists) throw notFound('手続き');
  const proc = snap.data() as ProcedureDoc;
  requireProcedureAccess(auth, proc);
  if (!proc.resignation || !proc.employeeId) throw invalidArg('この手続きは退職の画面では扱えません');
  return { ref, proc: proc as ResignationProcedure };
}

/** ウィザードで表示しているステップ */
export type ResignationStepKey = 'entry' | 'settlement' | 'account' | 'filing' | 'approval' | 'submit' | 'confirm' | 'done';

export function currentResignationStep(proc: ProcedureDoc): ResignationStepKey {
  if (proc.status === 'completed') return 'done';
  const s = (id: string) => stepOf(proc, id);
  if (!isDone(s('entry'))) return 'entry';
  if (!isDone(s('settlement'))) return 'settlement';
  if (!isDone(s('account'))) return 'account';
  if (s('filing_create').status === 'skipped') return 'confirm';
  if (!isDone(s('filing_create')) || s('filing_create').status === 'returned') return 'filing';
  if (s('approval').status !== 'completed') return 'approval';
  if (s('mock_filing').status !== 'completed' && s('paper_submit').status !== 'completed') return 'submit';
  return 'confirm';
}

interface Context {
  base: string;
  employee: EmployeeDoc;
  office: OfficeDoc;
  employment: ReturnType<typeof normalizeEmployment> | null;
  /** 雇用条件で社会保険の適用になる働き方か（年齢で加入しない人を含む） */
  socialInsuranceApplicable: boolean;
  user: { id: string; data: UserDoc } | null;
}

async function contextOf(companyId: string, proc: ResignationProcedure): Promise<Context> {
  const base = `companies/${companyId}`;
  const empPath = `${base}/employees/${proc.employeeId}`;
  const [emp, office, employment] = await Promise.all([
    db.doc(empPath).get(),
    db.doc(`${base}/offices/${proc.officeId}`).get(),
    db.collection(`${empPath}/employments`).orderBy('effectiveDate', 'desc').limit(1).get(),
  ]);
  if (!emp.exists) throw notFound('従業員');
  const employee = emp.data() as EmployeeDoc;
  const userSnap = employee.userId ? await db.doc(`${base}/users/${employee.userId}`).get() : null;
  return {
    base, employee,
    office: (office.data() ?? {}) as OfficeDoc,
    employment: employment.empty ? null : normalizeEmployment(employment.docs[0].data() as EmploymentDoc),
    socialInsuranceApplicable: employment.empty || (employment.docs[0].data() as EmploymentDoc).socialInsuranceEnrolled !== false,
    user: userSnap?.exists ? { id: userSnap.id, data: userSnap.data() as UserDoc } : null,
  };
}

function factsOf(ctx: Context, resignationDate: string, reason: LossReason): ResignationFacts {
  const e = ctx.employment;
  // 雇用条件がない旧データは加入しているものとして扱う（退職処理の旧方式と同じ）
  const enrolled = { health: e ? e.healthInsuranceEnrolled : true, pension: e ? e.pensionEnrolled : true };
  // 70歳以上で厚生年金・健康保険に入っていなくても、適用される働き方なら70歳以上被用者として届け出ている
  const birth = ctx.employee.birthDate ? toDateString(ctx.employee.birthDate) : null;
  const over70 = birth !== null && resignationDate >= ageReachDate(birth, 70);
  const anyEnrolled = enrolled.health || enrolled.pension || (over70 && ctx.socialInsuranceApplicable);
  return resignationFacts({
    resignationDate, reason,
    birthDate: ctx.employee.birthDate ? toDateString(ctx.employee.birthDate) : null,
    acquisitionDate: anyEnrolled ? qualificationDates({ ...ctx.employee, resignationDate: null } as EmployeeDoc).acquisitionDate : null,
    enrolled,
    isForeign: !!ctx.employee.foreignInfo,
  });
}

/** 未計算の月の見込み額（本人負担）。最新の等級と、その月の料率で計算する */
async function estimateMonth(companyId: string, ctx: Context, empPath: string, month: string): Promise<number | null> {
  const grades = await db.collection(`${empPath}/grades`).where('effectiveMonth', '<=', month).orderBy('effectiveMonth', 'desc').limit(1).get();
  if (grades.empty) return null;
  const grade = grades.docs[0].data() as GradeDoc;
  const rule = normalizeRoundingRule(ctx.office.roundingRule);
  const rates = await findAllRates(companyId, month, ctx.office.prefectureCode, ctx.office.insurerId, ctx.office.healthInsuranceType);
  const birth = ctx.employee.birthDate;
  const healthOn = (ctx.employment?.healthInsuranceEnrolled ?? true) && !isHealthExcluded(birth, month) && !!rates.health;
  const pensionOn = (ctx.employment?.pensionEnrolled ?? true) && !isPensionExcluded(birth, month) && !!rates.pension;
  let total = 0;
  if (healthOn) {
    total += splitPremium(grade.healthStandardRemuneration, rates.health!.employeeRate, rates.health!.employerRate, rule, rates.health!.totalRate).employeeAmount;
    if (rates.longTermCare && isLongTermCareAge(birth, month)) {
      total += splitPremium(grade.healthStandardRemuneration, rates.longTermCare.employeeRate, rates.longTermCare.employerRate, rule, rates.longTermCare.totalRate).employeeAmount;
    }
  }
  if (pensionOn) total += splitPremium(grade.pensionStandardRemuneration, rates.pension!.employeeRate, rates.pension!.employerRate, rule, rates.pension!.totalRate).employeeAmount;
  total += calculateChildSupportPayment(grade.healthStandardRemuneration, month, !healthOn, rule, rates.childSupportPayment).employeeAmount;
  return total;
}

/** 精算する月ごとの発生額と徴収済みの額。毎月の処理の保険料（承認済み・計算済み）と徴収の記録から読む */
async function settlementInputs(companyId: string, proc: ResignationProcedure, ctx: Context, facts: ResignationFacts): Promise<SettlementMonthInput[]> {
  if (!facts.lastChargedMonth) return [];
  const empPath = `${ctx.base}/employees/${proc.employeeId}`;
  const acquisition = qualificationDates({ ...ctx.employee, resignationDate: null } as EmployeeDoc).acquisitionDate!;
  const months = settlementMonths(acquisition, facts.lastChargedMonth);
  return Promise.all(months.map(async month => {
    const [ins, receipt] = await Promise.all([
      db.doc(`${empPath}/monthlyInsurance/${month}`).get(), db.doc(`${empPath}/collectionReceipts/${month}`).get(),
    ]);
    const collected = typeof receipt.data()?.collectedAmount === 'number' ? receipt.data()!.collectedAmount as number : 0;
    if (ins.exists) {
      return { month, due: ins.data()!.totalEmployeeAmount ?? 0, dueSource: ins.data()!.isConfirmed === true ? 'confirmed' as const : 'calculated' as const, collected };
    }
    const estimate = await estimateMonth(companyId, ctx, empPath, month);
    return estimate === null
      ? { month, due: 0, dueSource: 'noGrade' as const, collected }
      : { month, due: estimate, dueSource: 'estimate' as const, collected };
  }));
}

/** 最後の給与の支給月の初期値。退職月より後の給与が登録されていればその月、なければ退職月 */
async function defaultLastPayMonth(ctx: Context, proc: ResignationProcedure, resignationDate: string): Promise<string | null> {
  const snap = await db.collection(`${ctx.base}/employees/${proc.employeeId}/salaries`).orderBy('yearMonth', 'desc').limit(1).get();
  const latest = snap.empty ? null : snap.docs[0].data().yearMonth as string;
  const month = monthOf(resignationDate);
  return latest && latest > month ? latest : month;
}

/** lastPayMonth が null（退職後に支給する給与がない）なら、退職月までの給与は支給済みとして計算する */
function planOf(months: SettlementMonthInput[], ctx: Context, resignationDate: string, lastPayMonth: string | null) {
  const method = ctx.office.deductionMethod ?? 'previous';
  return lastPayMonth === null
    ? settlementPlan(months, method, monthOf(resignationDate), false)
    : settlementPlan(months, method, lastPayMonth);
}

async function filingLocked(companyId: string, proc: ResignationProcedure) {
  if (!proc.resignation.filingId) return false;
  const empPath = `companies/${companyId}/employees/${proc.employeeId}`;
  const f = await db.doc(`${empPath}/filings/${proc.resignation.filingId}`).get();
  if (f.exists && f.data()!.workflowStatus === 'approved') return true;
  const approvalId = latestApprovalId(proc);
  if (!approvalId) return false;
  const a = await db.doc(`${empPath}/approvalRequests/${approvalId}`).get();
  return a.exists && a.data()!.status === 'pending';
}

export async function getResignation(companyId: string, procedureId: string, auth: AuthContext) {
  let { proc } = await loadProcedure(companyId, procedureId, auth);
  if (proc.status === 'in_progress' && proc.resignation.filingId) {
    proc = (await refreshProcedure(companyId, procedureId)).procedure as ResignationProcedure;
  }
  const rs = proc.resignation;
  const ctx = await contextOf(companyId, proc);
  const empPath = `${ctx.base}/employees/${proc.employeeId}`;
  const [filingSnap, approvalSnap] = await Promise.all([
    rs.filingId ? db.doc(`${empPath}/filings/${rs.filingId}`).get() : null,
    latestApprovalId(proc) ? db.doc(`${empPath}/approvalRequests/${latestApprovalId(proc)}`).get() : null,
  ]);
  const filing = filingSnap?.exists ? filingSnap.data() as FilingDoc : null;

  const facts = rs.resignationDate ? factsOf(ctx, rs.resignationDate, rs.reason) : null;
  let settlement = null;
  if (facts && rs.resignationDate) {
    const lastPayMonth = rs.settlement ? rs.settlement.lastPayMonth : await defaultLastPayMonth(ctx, proc, rs.resignationDate);
    // 決めた後も、毎月の処理で記録した徴収の状況を反映して今の残りを出す
    const live = planOf(await settlementInputs(companyId, proc, ctx, facts), ctx, rs.resignationDate, lastPayMonth);
    settlement = { lastPayMonth, decided: rs.settlement !== null, ...live };
  }
  const e = ctx.employee;
  const enrolled = { health: ctx.employment?.healthInsuranceEnrolled ?? true, pension: ctx.employment?.pensionEnrolled ?? true };
  return {
    procedure: {
      id: procedureId, version: proc.version, status: proc.status, title: proc.title,
      officeId: proc.officeId, officeName: ctx.office.name ?? '', employeeName: proc.employeeName,
    },
    current: currentResignationStep(proc),
    steps: proc.steps.map(s => ({ id: s.id, label: s.label, status: s.status, statusDetail: s.statusDetail })),
    employee: {
      id: proc.employeeId!, employeeNumber: e.employeeNumber, name: nameOf(e),
      birthDate: e.birthDate ? toDateString(e.birthDate) : null,
      hireDate: e.hireDate ? toDateString(e.hireDate) : null,
      acquisitionDate: qualificationDates({ ...e, resignationDate: null } as EmployeeDoc).acquisitionDate,
      isForeign: !!e.foreignInfo, enrolled, otherEmployer: e.otherEmployer?.name ?? null,
    },
    office: { deductionMethod: ctx.office.deductionMethod ?? 'previous', paymentDay: ctx.office.paymentDay ?? null },
    entry: rs.resignationDate ? { resignationDate: rs.resignationDate, reason: rs.reason, note: rs.note } : null,
    facts,
    settlement,
    account: {
      hasUser: ctx.user !== null,
      email: ctx.user?.data.email ?? null,
      accessUntil: rs.accessUntil ?? facts?.account.accessUntil ?? null,
      viewOnlyFrom: facts?.account.viewOnlyFrom ?? null,
    },
    cards: rs.cards,
    filing: filing && rs.filingId ? {
      id: rs.filingId, version: filing.version, workflowStatus: filing.workflowStatus,
      mockStatus: filing.mockStatus, submissionStatus: filing.submissionStatus, resultNote: filing.resultNote,
    } : null,
    approval: approvalSnap?.exists ? { status: approvalSnap.data()!.status as string, comment: (approvalSnap.data()!.comment ?? null) as string | null } : null,
    locked: await filingLocked(companyId, proc),
  };
}

// ── 退職日と理由 ───────────────────────────────────────

export async function previewEntry(input: { companyId: string; procedureId: string; resignationDate: string; reason: LossReason }, auth: AuthContext) {
  const { proc } = await loadProcedure(input.companyId, input.procedureId, auth);
  const ctx = await contextOf(input.companyId, proc);
  validateDate(ctx, input.resignationDate);
  return factsOf(ctx, input.resignationDate, input.reason);
}

function validateDate(ctx: Context, resignationDate: string) {
  const { acquisitionDate } = qualificationDates({ ...ctx.employee, resignationDate: null } as EmployeeDoc);
  const hire = ctx.employee.hireDate ? toDateString(ctx.employee.hireDate) : null;
  const start = [acquisitionDate, hire].filter((d): d is string => !!d).sort()[0];
  if (start && resignationDate < start) throw invalidArg(`退職日が入社日（${start}）より前になっています`);
}

/**
 * 退職日を台帳に登録する。資格喪失日・閲覧専用とログイン停止の予定日を決め、届出と精算のステップを用意する。
 * 届出の承認を申請する前なら、何度でも入れ直せる（入れ直すと精算と届出は決め直しになる）
 */
export async function saveEntry(input: EntryInput, auth: AuthContext) {
  const { ref, proc } = await loadProcedure(input.companyId, input.procedureId, auth);
  requireVersion(proc, input.expectedVersion);
  if (await filingLocked(input.companyId, proc)) throw invalidArg('資格喪失届の承認を申請済みです。直す場合は承認者に差し戻してもらってください');
  const ctx = await contextOf(input.companyId, proc);
  validateDate(ctx, input.resignationDate);
  const facts = factsOf(ctx, input.resignationDate, input.reason);
  const empRef = db.doc(`${ctx.base}/employees/${proc.employeeId}`);
  const userRef = ctx.user ? db.doc(`${ctx.base}/users/${ctx.user.id}`) : null;
  const first = proc.resignation.appliedAt === null;

  await db.runTransaction(async tx => {
    const [latestSnap, empSnap] = await Promise.all([tx.get(ref), tx.get(empRef)]);
    const latest = latestSnap.data() as ResignationProcedure;
    requireVersion(latest, input.expectedVersion);
    const emp = empSnap.data() as EmployeeDoc;
    if (first && (!emp.isActive || emp.resignationDate)) throw invalidArg('この従業員はすでに退職済みです（別の手続きで登録されています）');
    const now = Timestamp.now();
    const accessUntil = facts.account.accessUntil;

    tx.update(empRef, {
      resignationDate: toTimestamp(input.resignationDate),
      qualificationLostDate: facts.needsFiling ? facts.lossDate : null,
      isActive: false,
      portalAccessUntil: endOfDayJst(accessUntil),
      updatedAt: now, version: emp.version + 1,
    });
    // 喪失日（退職日の翌日）から閲覧専用、閲覧期間の翌日からログイン停止。権限は残し、再入社のときに戻せるようにする
    // 喪失日を過ぎていれば停止も記録する（予定日を見ない旧い関数でも閲覧専用になるように）
    const today = todayJst();
    if (userRef) {
      tx.update(userRef, {
        suspendFrom: facts.account.viewOnlyFrom, loginDisabledFrom: facts.account.loginStopsFrom,
        ...(facts.account.viewOnlyFrom <= today ? { isSuspended: true } : {}), updatedAt: now,
      });
    }

    let steps = setStep(latest.steps, 'entry', { ...completed(auth.uid), statusDetail: `退職日 ${input.resignationDate}` });
    steps = setStep(steps, 'settlement', facts.lastChargedMonth
      ? { status: 'available', completedAt: null, completedBy: null, statusDetail: null }
      : { status: 'skipped', statusDetail: '保険料がかかる月がないため不要', completedAt: null, completedBy: null });
    steps = setStep(steps, 'account', { status: 'available', completedAt: null, completedBy: null, statusDetail: ctx.user ? null : 'アカウントなし' });
    for (const id of FILING_STEPS) {
      steps = setStep(steps, id, facts.needsFiling
        ? { status: id === 'filing_create' ? 'available' : 'blocked', referenceType: null, referenceId: null, referenceStatus: null, completedAt: null, completedBy: null, statusDetail: null }
        : { status: 'skipped', statusDetail: '社会保険に加入していないため不要', referenceType: null, referenceId: null, completedAt: null, completedBy: null });
    }
    steps = setStep(steps, 'confirm', { status: 'blocked', completedAt: null, completedBy: null });
    tx.update(ref, {
      'resignation.resignationDate': input.resignationDate, 'resignation.reason': input.reason, 'resignation.note': input.note,
      'resignation.appliedAt': latest.resignation.appliedAt ?? now, 'resignation.settlement': null, 'resignation.accessUntil': accessUntil,
      references: [
        ...latest.references.filter(r => r.type !== 'approval' && r.type !== 'employee'),
        { type: 'employee', documentId: proc.employeeId!, employeeId: proc.employeeId, documentSubtype: null, stepId: 'entry', createdAt: now },
      ],
      steps, statusReason: statusReasonOf(steps),
      deadline: facts.filingDeadline ? toTimestamp(facts.filingDeadline) : null,
      effectiveDate: toTimestamp(facts.lossDate),
      version: latest.version + 1, updatedAt: now,
    });
    tx.set(db.collection(`${ctx.base}/auditLogs`).doc(), {
      entity: 'employee', entityId: proc.employeeId, action: 'resign',
      changes: {
        resignationDate: { from: proc.resignation.resignationDate, to: input.resignationDate },
        qualificationLostDate: { from: emp.qualificationLostDate ?? null, to: facts.needsFiling ? facts.lossDate : null },
        isActive: { from: emp.isActive, to: false },
        suspendFrom: { from: ctx.user?.data.suspendFrom ?? null, to: userRef ? facts.account.viewOnlyFrom : null },
      },
      note: input.note || null, performedBy: auth.uid, performedAt: now, version: emp.version + 1,
    });
  });

  if (first) {
    const { notify } = await import('../utils/notify');
    await notify({
      companyId: input.companyId, title: '退職の登録',
      body: facts.filingDeadline
        ? `${proc.employeeName}さんの退職を登録しました（喪失日 ${facts.lossDate}）。資格喪失届の期限は ${facts.filingDeadline} です`
        : `${proc.employeeName}さんの退職を登録しました（社会保険に加入していないため届出はありません）`,
      category: 'filing', targetType: 'procedure', targetId: input.procedureId, createdBy: auth.uid,
    });
  }
  return { success: true, facts };
}

// ── 最後の保険料 ───────────────────────────────────────

async function settlementFor(companyId: string, proc: ResignationProcedure, lastPayMonth: string | null) {
  const rs = proc.resignation;
  if (!rs.resignationDate) throw invalidArg('先に退職日を入れてください');
  if (lastPayMonth !== null && lastPayMonth < monthOf(rs.resignationDate)) throw invalidArg('最後の給与の支給月は、退職した月以降にしてください');
  const ctx = await contextOf(companyId, proc);
  const facts = factsOf(ctx, rs.resignationDate, rs.reason);
  return planOf(await settlementInputs(companyId, proc, ctx, facts), ctx, rs.resignationDate, lastPayMonth);
}

export async function previewSettlement(input: { companyId: string; procedureId: string; lastPayMonth: string | null }, auth: AuthContext) {
  const { proc } = await loadProcedure(input.companyId, input.procedureId, auth);
  return settlementFor(input.companyId, proc, input.lastPayMonth);
}

export async function saveSettlement(input: { companyId: string; procedureId: string; expectedVersion: number; lastPayMonth: string | null }, auth: AuthContext) {
  const { ref, proc } = await loadProcedure(input.companyId, input.procedureId, auth);
  requireVersion(proc, input.expectedVersion);
  if (stepOf(proc, 'settlement').status === 'skipped') throw invalidArg('保険料がかかる月がないため、決める必要はありません');
  const plan = await settlementFor(input.companyId, proc, input.lastPayMonth);
  if (plan.unknownMonths.length) {
    throw invalidArg(`${plan.unknownMonths.map(m => `${Number(m.slice(5))}月分`).join('・')}は等級がないため保険料を計算できません。従業員台帳で等級を登録してから決めてください`);
  }
  const yen = (n: number) => `${n.toLocaleString('ja-JP')}円`;
  const detail = [
    plan.totals.payroll + plan.totals.final > 0 ? `給与から控除 ${yen(plan.totals.payroll + plan.totals.final)}` : '',
    plan.totals.transfer > 0 ? `別途回収 ${yen(plan.totals.transfer)}` : '',
    plan.totals.over > 0 ? `返金 ${yen(plan.totals.over)}` : '',
  ].filter(Boolean).join('・') || '集める保険料はありません';

  await db.runTransaction(async tx => {
    const latest = (await tx.get(ref)).data() as ResignationProcedure;
    requireVersion(latest, input.expectedVersion);
    const now = Timestamp.now();
    const steps = setStep(latest.steps, 'settlement', { ...completed(auth.uid), statusDetail: detail });
    tx.update(ref, {
      'resignation.settlement': {
        lastPayMonth: input.lastPayMonth,
        rows: plan.rows.map(r => ({ month: r.month, due: r.due, dueSource: r.dueSource, collected: r.collected, plan: r.plan, payMonth: r.payMonth })),
        totals: { payroll: plan.totals.payroll, final: plan.totals.final, transfer: plan.totals.transfer, over: plan.totals.over },
        decidedAt: now, decidedBy: auth.uid,
      },
      steps, statusReason: statusReasonOf(steps), version: latest.version + 1, updatedAt: now,
    });
  });

  // 給与から引けない分は、担当者に別途回収を知らせる（カタログ：未徴収額を表示し、別途回収が必要であることを通知）
  if (plan.totals.transfer > 0 || plan.totals.over > 0) {
    const { notify } = await import('../utils/notify');
    await notify({
      companyId: input.companyId,
      title: plan.totals.transfer > 0 ? '退職者の保険料の別途回収が必要です' : '退職者への保険料の返金が必要です',
      body: `${proc.employeeName}さん：${detail}。回収・返金したら、毎月の処理の「徴収を記録」で記録してください`,
      category: 'salary', targetType: 'procedure', targetId: input.procedureId, createdBy: auth.uid,
    });
  }
  return { success: true, plan };
}

// ── 退職後のアカウント ──────────────────────────────────

export async function saveAccount(input: { companyId: string; procedureId: string; expectedVersion: number; accessUntil: string }, auth: AuthContext) {
  const { ref, proc } = await loadProcedure(input.companyId, input.procedureId, auth);
  requireVersion(proc, input.expectedVersion);
  const rs = proc.resignation;
  if (!rs.resignationDate) throw invalidArg('先に退職日を入れてください');
  if (input.accessUntil < rs.resignationDate) throw invalidArg('閲覧できる最終日は、退職日以降にしてください');
  const ctx = await contextOf(input.companyId, proc);
  const facts = factsOf(ctx, rs.resignationDate, rs.reason);
  const loginStopsFrom = addDays(input.accessUntil, 1);

  await db.runTransaction(async tx => {
    const latest = (await tx.get(ref)).data() as ResignationProcedure;
    requireVersion(latest, input.expectedVersion);
    const now = Timestamp.now();
    tx.update(db.doc(`${ctx.base}/employees/${proc.employeeId}`), { portalAccessUntil: endOfDayJst(input.accessUntil), updatedAt: now });
    if (ctx.user) tx.update(db.doc(`${ctx.base}/users/${ctx.user.id}`), { loginDisabledFrom: loginStopsFrom, updatedAt: now });
    const changed = input.accessUntil !== facts.account.accessUntil;
    const detail = ctx.user ? `${input.accessUntil}まで閲覧可${changed ? '（期間を変更）' : ''}` : 'アカウントなし';
    const steps = setStep(latest.steps, 'account', { ...completed(auth.uid), statusDetail: detail });
    tx.update(ref, { 'resignation.accessUntil': input.accessUntil, steps, statusReason: statusReasonOf(steps), version: latest.version + 1, updatedAt: now });
    tx.set(db.collection(`${ctx.base}/auditLogs`).doc(), {
      entity: 'employee', entityId: proc.employeeId, action: 'update',
      changes: { portalAccessUntil: { from: rs.accessUntil, to: input.accessUntil } },
      performedBy: auth.uid, performedAt: now, version: 1,
    });
  });
  return { success: true };
}

// ── 資格喪失届と承認 ───────────────────────────────────

function lostInsuranceLabel(facts: ResignationFacts) {
  const { health, pension } = facts.lost;
  if (health && pension) return '健保・厚年';
  if (health) return '健保のみ';
  if (pension) return '厚年のみ';
  return 'なし（70歳以上被用者の不該当のみ）';
}

export async function submitLossFiling(input: { companyId: string; procedureId: string; expectedVersion: number; cardsReturned: number; cardsUnreturnable: number }, auth: AuthContext) {
  const { ref, proc } = await loadProcedure(input.companyId, input.procedureId, auth);
  requireVersion(proc, input.expectedVersion);
  const rs = proc.resignation;
  if (!rs.resignationDate) throw invalidArg('先に退職日を入れてください');
  if (stepOf(proc, 'filing_create').status === 'skipped') throw invalidArg('社会保険に加入していないため、資格喪失届は不要です');
  if (await filingLocked(input.companyId, proc)) throw invalidArg('資格喪失届は承認を申請済みです');

  const ctx = await contextOf(input.companyId, proc);
  const facts = factsOf(ctx, rs.resignationDate, rs.reason);
  const empPath = `${ctx.base}/employees/${proc.employeeId}`;
  const gradeSnap = await db.collection(`${empPath}/grades`).where('effectiveMonth', '<=', monthOf(rs.resignationDate)).orderBy('effectiveMonth', 'desc').limit(1).get();
  const grade = gradeSnap.empty ? null : gradeSnap.docs[0].data() as GradeDoc;
  const e = ctx.employee;

  // 画面の値は使わず、保存済みの退職日と台帳からサーバーで作る
  const formData = {
    '事業所整理記号': ctx.office.officeNumber ?? '',
    '事業所名称': ctx.office.name ?? '',
    '被保険者整理番号': e.insuredPersonNumber ?? '',
    '被保険者氏名': nameOf(e),
    '被保険者氏名フリガナ': `${e.lastNameKana} ${e.firstNameKana}`,
    '生年月日': e.birthDate ? toDateString(e.birthDate) : '',
    '性別': e.gender === 'male' ? '男' : '女',
    '個人番号': '',
    '基礎年金番号': e.basicPensionNumber ?? '',
    '届出区分': '資格喪失届',
    '資格喪失年月日': facts.lossDate,
    '喪失原因': facts.lossCause,
    [rs.reason === 'death' ? '死亡年月日' : '退職年月日']: rs.resignationDate,
    '喪失する保険': lostInsuranceLabel(facts),
    '70歳以上被用者不該当': facts.over70Worker ? '該当（退職日 ' + rs.resignationDate + '）' : '',
    '最終標準報酬月額_健康保険': facts.lost.health ? grade?.healthStandardRemuneration ?? null : null,
    '最終標準報酬月額_厚生年金': facts.lost.pension || facts.over70Worker ? grade?.pensionStandardRemuneration ?? null : null,
    '保険証回収_添付': input.cardsReturned,
    '保険証回収_返不能': input.cardsUnreturnable,
    '備考': [facts.sameMonth ? '同月得喪' : '', e.foreignInfo?.romanName ? `ローマ字氏名 ${e.foreignInfo.romanName}` : ''].filter(Boolean).join('／'),
  };

  const now = Timestamp.now();
  const filings = db.collection(`${empPath}/filings`);
  const existing = rs.filingId ? await filings.doc(rs.filingId).get() : null;
  const filingRef = existing?.exists ? existing.ref : filings.doc();
  let filingVersion = 1;
  if (existing?.exists) {
    filingVersion = (existing.data()!.version as number) + 1;
    await filingRef.update({ formData, workflowStatus: 'draft', effectiveDate: facts.lossDate, version: filingVersion, updatedAt: now });
  } else {
    await filingRef.set({
      filingType: 'lossNotification', workflowStatus: 'draft', mockStatus: 'notStarted', submissionStatus: 'notSubmitted',
      effectiveDate: facts.lossDate, formData, submittedAt: null, resultReceivedAt: null, resultNote: null,
      version: 1, createdAt: now, updatedAt: now,
    } satisfies FilingDoc);
  }
  await db.collection(`${ctx.base}/auditLogs`).doc().set({
    entity: 'filing', entityId: filingRef.id, action: existing?.exists ? 'update' : 'create',
    changes: { source: { from: null, to: 'resignation' } }, performedBy: auth.uid, performedAt: now, version: filingVersion,
  });

  const filingId = filingRef.id;
  await db.runTransaction(async tx => {
    const latest = (await tx.get(ref)).data() as ResignationProcedure;
    requireVersion(latest, input.expectedVersion);
    let steps = setStep(latest.steps, 'filing_create', { ...completed(auth.uid), referenceType: 'filing', referenceId: filingId, statusDetail: '作成済み' });
    steps = setStep(steps, 'approval', { status: 'blocked', referenceType: null, referenceId: null, referenceStatus: null, completedAt: null, completedBy: null });
    for (const id of ['mock_filing', 'paper_submit']) steps = setStep(steps, id, { referenceType: 'filing', referenceId: filingId });
    const references = [
      ...latest.references.filter(r => r.type !== 'filing' && r.type !== 'approval'),
      { type: 'filing' as const, documentId: filingId, employeeId: proc.employeeId, documentSubtype: 'lossNotification', stepId: 'filing_create', createdAt: now },
    ];
    tx.update(ref, {
      'resignation.filingId': filingId, 'resignation.cards': { returned: input.cardsReturned, unreturnable: input.cardsUnreturnable },
      steps, references, version: latest.version + 1, updatedAt: now,
    });
  });

  const { id: requestId } = await createApprovalRequest({
    companyId: input.companyId,
    employeeId: proc.employeeId!,
    targetPath: `${empPath}/filings/${filingId}`,
    targetVersion: filingVersion,
    requestType: 'filing',
    comment: `${proc.employeeName}さんの資格喪失届（${rs.reason === 'death' ? '死亡日' : '退職日'} ${rs.resignationDate}・喪失日 ${facts.lossDate}）`,
    metadata: { source: 'resignation', procedureId: input.procedureId },
  }, auth);
  await refreshProcedure(input.companyId, input.procedureId);
  return { success: true, filingId, requestId };
}

// ── 完了 ──────────────────────────────────────────

export async function completeResignation(input: { companyId: string; procedureId: string; expectedVersion: number }, auth: AuthContext) {
  const { ref, proc } = await loadProcedure(input.companyId, input.procedureId, auth);
  requireVersion(proc, input.expectedVersion);
  for (const id of ['entry', 'settlement', 'account']) {
    if (!isDone(stepOf(proc, id))) throw invalidArg(`先に「${stepOf(proc, id).label}」を済ませてください`);
  }
  if (stepOf(proc, 'filing_create').status !== 'skipped') {
    return confirmProcedure({ procedureId: input.procedureId, stepId: 'confirm', expectedVersion: input.expectedVersion }, auth);
  }
  await db.runTransaction(async tx => {
    const latest = (await tx.get(ref)).data() as ProcedureDoc;
    requireVersion(latest, input.expectedVersion);
    const now = Timestamp.now();
    const steps = setStep(latest.steps, 'confirm', completed(auth.uid));
    tx.update(ref, { steps, status: 'completed', statusReason: '社会保険に加入していないため届出なしで完了', completedAt: now, updatedAt: now, version: latest.version + 1 });
    tx.set(db.collection(`companies/${input.companyId}/auditLogs`).doc(), {
      entity: 'procedure', entityId: input.procedureId, action: 'update', changes: { status: { from: latest.status, to: 'completed' } },
      performedBy: auth.uid, performedAt: now, version: latest.version + 1,
    });
  });
  return { success: true, id: input.procedureId };
}

