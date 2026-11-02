import { createHash, randomBytes } from 'crypto';
import { FieldPath, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { assertAssignable } from '../offices/lifecycle';
import { db } from '../config';
import { AuthContext, requireOffice } from '../middleware/auth';
import {
  EmployeeDoc, EmploymentDoc, FilingDoc, OfficeDoc, OnboardingState, ProcedureDoc, ProcedureStep,
} from '../types/firestore';
import { invalidArg, notFound } from '../utils/errors';
import { toDateString, toTimestamp } from '../utils/firestore';
import {
  acquisitionRemuneration, fiveDayDeadline, eligibilityByAge, judgeApplicability, lookupGrade, monthlyHoursFromWeekly,
  resolveGradeTable, ApplicabilityJudgement,
} from '../insurance/calculator';
import { buildOnboardingSteps } from '../procedures/templates';
import { requireProcedureAccess } from '../procedures/access';
import { refreshProcedure } from '../procedures/refresh';
import { createEmployee } from '../employees/employee-create/service';
import { createEmployment } from '../employments/employment-create/service';
import { createApprovalRequest } from '../approvals/approval-request-create/service';
import { confirmProcedure } from '../procedures/procedure-action/service';
import { ContractInput, OnboardingStartInput, RegisterInput } from './schema';

/** 招待リンクの有効期間 */
const INVITE_DAYS = 14;
/** 社会保険に加入する場合だけ行うステップ */
const INSURANCE_STEPS = ['filing_create', 'approval', 'mock_filing', 'paper_submit'];

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * 資格取得届の提出期限。事実発生（資格取得日）から5日以内で、初日は数えない（民法140条）。
 * 期限が行政機関の休日（土日・祝日・年末年始）にあたるときは翌開庁日まで延びる。
 */
export function acquisitionFilingDeadline(hireDate: string): string {
  return fiveDayDeadline(hireDate);
}

/** 手続きIDから決まる requestId（従業員登録をやり直しても二重に登録しない） */
function requestIdFor(procedureId: string): string {
  const h = createHash('sha256').update(`onboarding:${procedureId}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function newInvite() {
  const token = randomBytes(24).toString('base64url');
  return { token, expiresAt: Timestamp.fromMillis(Date.now() + INVITE_DAYS * 86_400_000) };
}

function setStep(steps: ProcedureStep[], id: string, patch: Partial<ProcedureStep>) {
  return steps.map(s => s.id === id ? { ...s, ...patch } : s);
}

function completed(by: string): Partial<ProcedureStep> {
  return { status: 'completed', completedAt: Timestamp.now(), completedBy: by, statusDetail: null, actionLabel: null, actionRoute: null };
}

function statusReasonOf(steps: ProcedureStep[]) {
  const next = steps.find(s => s.status === 'available' || s.status === 'in_progress' || s.status === 'returned');
  return next ? `${next.label}` : '全ステップ完了';
}

// ── 開始 ────────────────────────────────────────────

export async function startOnboarding(input: OnboardingStartInput, auth: AuthContext) {
  requireOffice(auth, input.officeId);
  const officeSnap = await db.doc(`companies/${auth.companyId}/offices/${input.officeId}`).get();
  if (!officeSnap.exists) throw invalidArg('指定された事業所が存在しません');
  // 設定が終わっていない事業所・廃止した事業所には配属しない（カタログ1章 事業所ライフサイクル）
  await assertAssignable(auth.companyId, input.officeId);

  const base = `companies/${auth.companyId}`;
  const batchId = input.people.length > 1 ? db.collection(`${base}/procedures`).doc().id : null;
  const items: { procedureId: string; name: string; token: string | null }[] = [];

  // 1人につき書き込み3件（手続き・招待・監査ログ）。1回のバッチは500件まで
  for (let i = 0; i < input.people.length; i += 150) {
    const batch = db.batch();
    const now = Timestamp.now();
    for (const person of input.people.slice(i, i + 150)) {
      const name = `${person.lastName} ${person.firstName}`;
      const ref = db.collection(`${base}/procedures`).doc();
      const invite = input.skipInvite ? null : newInvite();
      let steps = buildOnboardingSteps();
      if (input.skipInvite) {
        steps = setStep(steps, 'invite', { ...completed(auth.uid), statusDetail: '担当者が入力' });
        steps = setStep(steps, 'register', { status: 'available' });
      } else {
        steps = setStep(steps, 'invite', { status: 'in_progress', statusDetail: '本人の入力待ち' });
      }
      const onboarding: OnboardingState = {
        hireDate: input.hireDate,
        plannedName: name,
        email: person.email ?? null,
        inviteToken: invite?.token ?? null,
        inviteExpiresAt: invite?.expiresAt ?? null,
        inviteSkipped: input.skipInvite,
        selfInput: null,
        selfInputAt: null,
        employmentId: null,
        allowances: 0,
        inKind: 0,
        filingId: null,
        batchId,
      };
      batch.set(ref, {
        procedureType: 'acquisition',
        title: `${name} 入社手続き`,
        priority: 'normal',
        status: 'in_progress',
        statusReason: statusReasonOf(steps),
        employeeId: null,
        employeeName: name,
        officeId: input.officeId,
        targetOfficeId: null,
        scope: 'individual',
        batchMeta: null,
        invitationId: null,
        onboardToken: null,
        steps,
        deadline: toTimestamp(acquisitionFilingDeadline(input.hireDate)),
        effectiveDate: toTimestamp(input.hireDate),
        assignedTo: auth.uid,
        createdBy: auth.uid,
        references: [],
        notes: '',
        version: 1,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
        deletedAt: null,
        onboarding,
      } satisfies ProcedureDoc);
      if (invite) {
        batch.set(db.doc(`onboardInvites/${hashToken(invite.token)}`), {
          companyId: auth.companyId, procedureId: ref.id, expiresAt: invite.expiresAt, createdAt: now,
        });
      }
      batch.set(db.collection(`${base}/auditLogs`).doc(), {
        entity: 'procedure', entityId: ref.id, action: 'create',
        changes: { procedureType: { from: null, to: 'acquisition' }, batchId: { from: null, to: batchId } },
        performedBy: auth.uid, performedAt: now, version: 1,
      });
      items.push({ procedureId: ref.id, name, token: invite?.token ?? null });
    }
    await batch.commit();
  }
  return { batchId, items };
}

// ── 読み取り ────────────────────────────────────────

async function loadProcedure(companyId: string, procedureId: string, auth: AuthContext) {
  const ref = db.doc(`companies/${companyId}/procedures/${procedureId}`);
  const snap = await ref.get();
  if (!snap.exists) throw notFound('手続き');
  const proc = snap.data() as ProcedureDoc;
  requireProcedureAccess(auth, proc);
  if (!proc.onboarding) throw invalidArg('この手続きは入社の画面では扱えません');
  return { ref, proc: proc as ProcedureDoc & { onboarding: OnboardingState } };
}

function requireVersion(proc: ProcedureDoc, expected: number) {
  if (proc.version !== expected) throw new HttpsError('aborted', '手続きが更新されています。画面を読み込み直してください');
  if (proc.status === 'completed' || proc.status === 'cancelled') throw invalidArg('この手続きは終了しています');
}

function stepOf(proc: ProcedureDoc, id: string) {
  return proc.steps.find(s => s.id === id)!;
}

/**
 * 資格取得届の承認申請のID。手続きの共通の更新処理が承認ステップの参照を届出に書き換えるため、
 * ステップではなく参照の一覧（承認申請時に追加される）から引く
 */
function latestApprovalId(proc: ProcedureDoc): string | null {
  const refs = proc.references.filter(r => r.type === 'approval' && r.stepId === 'approval');
  return refs.length ? refs[refs.length - 1].documentId : null;
}

interface ContractContext {
  birthDate: string;
  hireDate: string;
  office: Partial<OfficeDoc>;
  specificApplicableOffice: boolean | null;
}

/** 加入の判定と資格取得時決定の等級（保存しない）。画面のプレビューと保存・申請で同じ計算を使う */
export function evaluateContract(input: Omit<ContractInput, 'companyId' | 'procedureId'>, ctx: ContractContext) {
  const judgement: ApplicabilityJudgement = judgeApplicability({
    employmentType: input.employmentType,
    weeklyHours: input.weeklyHours,
    monthlyDays: input.monthlyDays,
    fullTimeWeeklyHours: ctx.office.fullTimeWeeklyHours ?? 40,
    fullTimeMonthlyDays: ctx.office.fullTimeMonthlyDays ?? 21,
    isSpecificApplicableOffice: ctx.specificApplicableOffice,
    contractType: input.contractType,
    contractStartDate: ctx.hireDate,
    contractEndDate: input.contractEndDate ?? null,
    renewalExpected: input.renewalExpected,
    isStudent: input.isStudent,
  });
  const age = eligibilityByAge(ctx.birthDate, ctx.hireDate);
  const applicable = judgement.result === 'applicable';
  const expected = { health: applicable && age.health, pension: applicable && age.pension };
  const chosen = {
    health: input.healthInsuranceEnrolled ?? expected.health,
    pension: input.pensionEnrolled ?? expected.pension,
  };
  // 判定と違う加入区分（非常勤役員の手動判断を含む）には理由が要る。年齢だけによる違いは理由を自動で残す
  const differsFromExpected = judgement.result === 'manual' || chosen.health !== expected.health || chosen.pension !== expected.pension;
  const monthlyHours = input.wageType === 'hourly' ? (input.monthlyHours ?? monthlyHoursFromWeekly(input.weeklyHours)) : input.monthlyHours;
  const remuneration = acquisitionRemuneration({
    wageType: input.wageType, wageAmount: input.wageAmount, monthlyDays: input.monthlyDays,
    monthlyHours, allowances: input.allowances, inKind: input.inKind,
  });
  const health = lookupGrade(resolveGradeTable('health'), remuneration);
  const pension = lookupGrade(resolveGradeTable('pension'), remuneration);
  return {
    judgement: { result: judgement.result, reason: judgement.reason, insuredCategory: judgement.insuredCategory },
    ageNotes: age.notes,
    expected,
    chosen,
    longTermCare: chosen.health && age.longTermCare,
    needsReason: differsFromExpected,
    monthlyHours: monthlyHours ?? null,
    remuneration,
    healthGrade: { gradeNumber: health.gradeNumber, standardRemuneration: health.standardRemuneration },
    pensionGrade: { gradeNumber: pension.gradeNumber, standardRemuneration: pension.standardRemuneration },
  };
}

async function contractContext(companyId: string, proc: ProcedureDoc & { onboarding: OnboardingState }): Promise<ContractContext> {
  if (!proc.employeeId) throw invalidArg('先に台帳に登録してください');
  const [emp, office, company] = await Promise.all([
    db.doc(`companies/${companyId}/employees/${proc.employeeId}`).get(),
    db.doc(`companies/${companyId}/offices/${proc.officeId}`).get(),
    db.doc(`companies/${companyId}`).get(),
  ]);
  if (!emp.exists) throw notFound('従業員');
  const employee = emp.data() as EmployeeDoc;
  if (!employee.birthDate) throw invalidArg('生年月日が登録されていません。従業員台帳で生年月日を入れてください');
  const specific = company.exists ? company.data()!.specificApplicableOffice : undefined;
  return {
    birthDate: toDateString(employee.birthDate),
    hireDate: proc.onboarding.hireDate,
    office: (office.exists ? office.data() : {}) as Partial<OfficeDoc>,
    specificApplicableOffice: typeof specific === 'boolean' ? specific : null,
  };
}

/** 保存済みの雇用条件を、判定の入力の形に戻す */
function contractFromEmployment(e: EmploymentDoc, ob: OnboardingState) {
  return {
    employmentType: e.employmentType,
    weeklyHours: e.weeklyHours,
    monthlyDays: e.monthlyDays,
    wageType: e.wageType ?? 'monthly',
    wageAmount: e.wageAmount ?? e.baseSalary,
    monthlyHours: e.monthlyHours ?? null,
    allowances: ob.allowances,
    inKind: ob.inKind,
    contractType: e.contractType ?? 'indefinite',
    contractEndDate: e.contractEndDate ?? null,
    renewalExpected: e.renewalExpected ?? false,
    probationStartDate: e.probationStartDate ?? null,
    probationEndDate: e.probationEndDate ?? null,
    isStudent: e.isStudent ?? false,
    healthInsuranceEnrolled: e.healthInsuranceEnrolled ?? e.socialInsuranceEnrolled,
    pensionEnrolled: e.pensionEnrolled ?? e.socialInsuranceEnrolled,
    overrideReason: e.applicabilityOverride?.reason,
  };
}

/** ウィザードで表示しているステップ */
export type WizardStepKey = 'invite' | 'register' | 'contract' | 'filing' | 'approval' | 'submit' | 'confirm' | 'done';

export function currentWizardStep(proc: ProcedureDoc): WizardStepKey {
  if (proc.status === 'completed') return 'done';
  const s = (id: string) => stepOf(proc, id);
  const done = (id: string) => ['completed', 'skipped'].includes(s(id).status);
  if (!done('invite')) return 'invite';
  if (!done('register')) return 'register';
  if (!done('contract')) return 'contract';
  if (s('filing_create').status === 'skipped') return 'confirm';
  if (!done('filing_create') || s('filing_create').status === 'returned') return 'filing';
  if (s('approval').status !== 'completed') return 'approval';
  if (s('mock_filing').status !== 'completed' && s('paper_submit').status !== 'completed') return 'submit';
  return 'confirm';
}

export async function getOnboarding(companyId: string, procedureId: string, auth: AuthContext) {
  let { proc } = await loadProcedure(companyId, procedureId, auth);
  if (proc.employeeId && proc.status === 'in_progress') {
    proc = (await refreshProcedure(companyId, procedureId)).procedure as typeof proc;
  }
  const ob = proc.onboarding;
  const base = `companies/${companyId}`;
  const [office, employeeSnap, employmentSnap, filingSnap] = await Promise.all([
    db.doc(`${base}/offices/${proc.officeId}`).get(),
    proc.employeeId ? db.doc(`${base}/employees/${proc.employeeId}`).get() : null,
    proc.employeeId && ob.employmentId ? db.doc(`${base}/employees/${proc.employeeId}/employments/${ob.employmentId}`).get() : null,
    proc.employeeId && ob.filingId ? db.doc(`${base}/employees/${proc.employeeId}/filings/${ob.filingId}`).get() : null,
  ]);
  const employee = employeeSnap?.exists ? employeeSnap.data() as EmployeeDoc : null;
  const employment = employmentSnap?.exists ? employmentSnap.data() as EmploymentDoc : null;
  const filing = filingSnap?.exists ? filingSnap.data() as FilingDoc : null;

  const approvalId = latestApprovalId(proc);
  let approval: { status: string; comment: string | null } | null = null;
  if (proc.employeeId && approvalId) {
    const a = await db.doc(`${base}/employees/${proc.employeeId}/approvalRequests/${approvalId}`).get();
    if (a.exists) approval = { status: a.data()!.status, comment: a.data()!.comment ?? null };
  }

  let contract = null;
  let evaluation = null;
  if (employment && employee?.birthDate) {
    contract = contractFromEmployment(employment, ob);
    evaluation = evaluateContract(contract, await contractContext(companyId, proc));
  }

  return {
    procedure: {
      id: procedureId, version: proc.version, status: proc.status, title: proc.title,
      officeId: proc.officeId, officeName: office.exists ? (office.data()!.name as string) : '',
      hireDate: ob.hireDate, deadline: acquisitionFilingDeadline(ob.hireDate),
      plannedName: ob.plannedName, employeeName: proc.employeeName, batchId: ob.batchId,
    },
    current: currentWizardStep(proc),
    steps: proc.steps.map(s => ({ id: s.id, label: s.label, status: s.status, statusDetail: s.statusDetail })),
    invite: {
      token: ob.inviteToken,
      expiresAt: ob.inviteExpiresAt?.toDate().toISOString() ?? null,
      skipped: ob.inviteSkipped,
      submittedAt: ob.selfInputAt?.toDate().toISOString() ?? null,
      email: ob.email,
    },
    selfInput: ob.selfInput,
    employee: employee && proc.employeeId ? {
      id: proc.employeeId, employeeNumber: employee.employeeNumber,
      name: `${employee.lastName} ${employee.firstName}`,
      birthDate: employee.birthDate ? toDateString(employee.birthDate) : null,
    } : null,
    contract,
    evaluation,
    applicabilityOverride: employment?.applicabilityOverride ?? null,
    filing: filing && ob.filingId ? {
      id: ob.filingId, version: filing.version, workflowStatus: filing.workflowStatus,
      mockStatus: filing.mockStatus, submissionStatus: filing.submissionStatus, resultNote: filing.resultNote,
    } : null,
    approval,
  };
}

/**
 * 入社手続きの一覧。画面は事業所×入社日で束ねて「まとめ」として出す（hireDate を渡すと、そのまとめの人だけ）。
 * 従業員を登録したときに自動で作られる旧方式の資格取得の手続き（onboarding がない）も同じ種類のため、
 * 件数で切ると新しい入社手続きが漏れる。1000件ずつ最後まで読む（条件はすべて等価で、複合索引に頼らない）
 */
export async function listOnboarding(input: { officeId?: string; batchId?: string; hireDate?: string; includeCompleted: boolean }, auth: AuthContext) {
  if (input.officeId) requireOffice(auth, input.officeId);
  let query: FirebaseFirestore.Query = db.collection(`companies/${auth.companyId}/procedures`)
    .where('procedureType', '==', 'acquisition')
    .where('deletedAt', '==', null);
  if (!input.includeCompleted) query = query.where('status', '==', 'in_progress');
  if (input.batchId) query = query.where('onboarding.batchId', '==', input.batchId);
  if (input.hireDate) query = query.where('onboarding.hireDate', '==', input.hireDate);
  if (input.officeId) query = query.where('officeId', '==', input.officeId);
  const docs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  for (let page = 0; page < 20; page++) {
    let q = query.orderBy(FieldPath.documentId()).limit(1000);
    if (docs.length) q = q.startAfter(docs[docs.length - 1].id);
    const snap = await q.get();
    docs.push(...snap.docs);
    if (snap.size < 1000) break;
  }
  const items = docs
    .map(d => ({ id: d.id, ...(d.data() as ProcedureDoc) }))
    .filter(p => p.onboarding)
    .filter(p => !input.officeId || p.officeId === input.officeId)
    .filter(p => auth.roles.includes('admin') || auth.officeIds.includes(p.officeId))
    .map(p => ({
      id: p.id, version: p.version, status: p.status, name: p.employeeName, officeId: p.officeId,
      hireDate: p.onboarding!.hireDate, batchId: p.onboarding!.batchId, current: currentWizardStep(p),
      currentDetail: p.steps.find(s => s.status === 'in_progress' || s.status === 'returned')?.statusDetail ?? null,
      hold: p.onboarding!.hold ? { reason: p.onboarding!.hold.reason } : null,
      inviteToken: p.onboarding!.inviteToken, selfInputAt: p.onboarding!.selfInputAt?.toDate().toISOString() ?? null,
      createdAt: p.createdAt.toDate().toISOString(),
    }))
    .sort((a, b) => a.hireDate.localeCompare(b.hireDate) || a.name.localeCompare(b.name, 'ja'));
  return { items };
}

// ── 招待（本人入力） ────────────────────────────────────

export async function inviteAction(input: { companyId: string; procedureId: string; expectedVersion: number; action: 'skip' | 'reissue' }, auth: AuthContext) {
  const { ref, proc } = await loadProcedure(input.companyId, input.procedureId, auth);
  requireVersion(proc, input.expectedVersion);
  if (stepOf(proc, 'register').status === 'completed') throw invalidArg('台帳に登録済みです');
  const now = Timestamp.now();
  const batch = db.batch();
  if (proc.onboarding.inviteToken) batch.delete(db.doc(`onboardInvites/${hashToken(proc.onboarding.inviteToken)}`));
  let steps = proc.steps;
  const onboarding = { ...proc.onboarding };
  let token: string | null = null;
  if (input.action === 'skip') {
    onboarding.inviteToken = null;
    onboarding.inviteExpiresAt = null;
    onboarding.inviteSkipped = true;
    steps = setStep(steps, 'invite', { ...completed(auth.uid), statusDetail: '担当者が入力' });
    steps = setStep(steps, 'register', { status: 'available' });
  } else {
    const invite = newInvite();
    token = invite.token;
    onboarding.inviteToken = invite.token;
    onboarding.inviteExpiresAt = invite.expiresAt;
    onboarding.inviteSkipped = false;
    batch.set(db.doc(`onboardInvites/${hashToken(invite.token)}`), {
      companyId: input.companyId, procedureId: input.procedureId, expiresAt: invite.expiresAt, createdAt: now,
    });
  }
  batch.update(ref, { onboarding, steps, statusReason: statusReasonOf(steps), version: proc.version + 1, updatedAt: now });
  await batch.commit();
  return { success: true, token };
}

async function findInvite(token: string) {
  const snap = await db.doc(`onboardInvites/${hashToken(token)}`).get();
  if (!snap.exists) throw new HttpsError('not-found', 'このリンクは使えません。会社の担当者に新しいリンクを依頼してください');
  const invite = snap.data()!;
  if ((invite.expiresAt as Timestamp).toMillis() < Date.now()) {
    throw new HttpsError('failed-precondition', 'このリンクは有効期限が切れています。会社の担当者に新しいリンクを依頼してください');
  }
  const ref = db.doc(`companies/${invite.companyId}/procedures/${invite.procedureId}`);
  return { ref, companyId: invite.companyId as string };
}

/** 本人用（ログイン不要）。リンクの持ち主に、入力済みの内容だけを返す */
export async function getInvite(token: string) {
  const { ref, companyId } = await findInvite(token);
  const [snap, company] = await Promise.all([ref.get(), db.doc(`companies/${companyId}`).get()]);
  const proc = snap.data() as ProcedureDoc | undefined;
  if (!proc?.onboarding || proc.onboarding.inviteToken !== token || proc.deletedAt || proc.status === 'cancelled') {
    throw new HttpsError('not-found', 'このリンクは使えません。会社の担当者に新しいリンクを依頼してください');
  }
  return {
    companyName: company.exists ? (company.data()!.name as string) : '',
    plannedName: proc.onboarding.plannedName,
    hireDate: proc.onboarding.hireDate,
    submitted: proc.onboarding.selfInputAt !== null,
    locked: stepOf(proc, 'register').status === 'completed',
    data: proc.onboarding.selfInput,
  };
}

export async function submitInvite(token: string, data: OnboardingState['selfInput']) {
  const { ref, companyId } = await findInvite(token);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const proc = snap.data() as ProcedureDoc | undefined;
    if (!proc?.onboarding || proc.onboarding.inviteToken !== token || proc.deletedAt || proc.status !== 'in_progress') {
      throw new HttpsError('not-found', 'このリンクは使えません。会社の担当者に新しいリンクを依頼してください');
    }
    if (stepOf(proc, 'register').status === 'completed') throw invalidArg('会社での登録が済んだため、ここからは変更できません。会社の担当者に連絡してください');
    const now = Timestamp.now();
    let steps = setStep(proc.steps, 'invite', { ...completed('self'), statusDetail: '本人が入力' });
    steps = setStep(steps, 'register', { status: 'available' });
    tx.update(ref, {
      'onboarding.selfInput': data, 'onboarding.selfInputAt': now,
      steps, statusReason: statusReasonOf(steps), version: proc.version + 1, updatedAt: now,
    });
  });
  const proc = (await ref.get()).data() as ProcedureDoc;
  const { notify } = await import('../utils/notify');
  await notify({
    companyId, title: '入社する人が入力しました', body: `${proc.employeeName}さんの入力が届きました。内容を確かめて台帳に登録してください`,
    category: 'system', targetType: 'procedure', targetId: ref.id, createdBy: 'self', officeId: proc.officeId ?? null,
  });
  return { success: true };
}

// ── 台帳への登録 ───────────────────────────────────────

export async function registerEmployee(input: RegisterInput, auth: AuthContext) {
  const { ref, proc } = await loadProcedure(input.companyId, input.procedureId, auth);
  requireVersion(proc, input.expectedVersion);
  if (!['completed', 'skipped'].includes(stepOf(proc, 'invite').status)) throw invalidArg('本人の入力がまだ届いていません');
  if (stepOf(proc, 'register').status === 'completed') throw invalidArg('台帳に登録済みです');
  const p = input.profile;
  const { id: employeeId } = await createEmployee({
    companyId: input.companyId,
    employeeNumber: input.employeeNumber,
    lastName: p.lastName, firstName: p.firstName, lastNameKana: p.lastNameKana, firstNameKana: p.firstNameKana,
    birthDate: p.birthDate, gender: p.gender,
    officeId: proc.officeId, departmentId: input.departmentId ?? null,
    hireDate: proc.onboarding.hireDate,
    requestId: requestIdFor(input.procedureId),
    postalCode: p.postalCode, prefecture: p.prefecture, city: p.city, addressLine: p.addressLine, building: p.building,
    phone: p.phone, email: p.email,
    insuredPersonNumber: input.insuredPersonNumber ?? null,
    qualificationAcquiredDate: proc.onboarding.hireDate,
  }, auth);

  const name = `${p.lastName} ${p.firstName}`;
  await db.runTransaction(async tx => {
    const latest = (await tx.get(ref)).data() as ProcedureDoc;
    requireVersion(latest, input.expectedVersion);
    const now = Timestamp.now();
    let steps = setStep(latest.steps, 'register', { ...completed(auth.uid), referenceType: 'employee', referenceId: employeeId, statusDetail: '登録済み' });
    steps = setStep(steps, 'contract', { status: 'available' });
    tx.update(ref, {
      employeeId, employeeName: name, title: `${name} 入社手続き`,
      'onboarding.selfInput': p,
      steps, statusReason: statusReasonOf(steps),
      references: FieldValue.arrayUnion({ type: 'employee', documentId: employeeId, employeeId, documentSubtype: null, stepId: 'register', createdAt: now }),
      version: latest.version + 1, updatedAt: now,
    });
  });
  return { success: true, employeeId };
}

// ── 雇用条件（加入の判定） ──────────────────────────────

export async function previewContract(input: ContractInput, auth: AuthContext) {
  const { proc } = await loadProcedure(input.companyId, input.procedureId, auth);
  return evaluateContract(input, await contractContext(input.companyId, proc));
}

/** 資格取得届が承認待ちか承認済みなら、雇用条件と届出は直せない（差し戻されたら直せる） */
async function filingLocked(companyId: string, proc: ProcedureDoc & { onboarding: OnboardingState }) {
  if (!proc.employeeId || !proc.onboarding.filingId) return false;
  const empPath = `companies/${companyId}/employees/${proc.employeeId}`;
  const f = await db.doc(`${empPath}/filings/${proc.onboarding.filingId}`).get();
  if (f.exists && f.data()!.workflowStatus === 'approved') return true;
  const approvalId = latestApprovalId(proc);
  if (!approvalId) return false;
  const a = await db.doc(`${empPath}/approvalRequests/${approvalId}`).get();
  return a.exists && a.data()!.status === 'pending';
}

export async function saveContract(input: ContractInput & { expectedVersion: number }, auth: AuthContext) {
  const { ref, proc } = await loadProcedure(input.companyId, input.procedureId, auth);
  requireVersion(proc, input.expectedVersion);
  if (stepOf(proc, 'register').status !== 'completed' || !proc.employeeId) throw invalidArg('先に台帳に登録してください');
  if (await filingLocked(input.companyId, proc)) throw invalidArg('資格取得届の承認を申請済みです。直す場合は承認者に差し戻してもらってください');

  const ctx = await contractContext(input.companyId, proc);
  const ev = evaluateContract(input, ctx);
  let overrideReason = input.overrideReason;
  if (ev.needsReason && !overrideReason) {
    const onlyAge = ev.judgement.result === 'applicable' && ev.chosen.health === ev.expected.health && ev.chosen.pension === ev.expected.pension;
    if (!onlyAge) throw invalidArg(`加入の判定（${ev.judgement.reason}）と異なる加入区分にする場合は理由を入力してください`);
    overrideReason = ev.ageNotes.join('／');
  }

  const base = `companies/${input.companyId}/employees/${proc.employeeId}/employments`;
  if (proc.onboarding.employmentId) await db.doc(`${base}/${proc.onboarding.employmentId}`).delete();
  const baseSalary = input.wageType === 'monthly' ? input.wageAmount : ev.remuneration - input.allowances - input.inKind;
  const { id: employmentId } = await createEmployment({
    companyId: input.companyId,
    employeeId: proc.employeeId,
    effectiveDate: ctx.hireDate,
    employmentType: input.employmentType,
    weeklyHours: input.weeklyHours,
    monthlyDays: input.monthlyDays,
    baseSalary,
    socialInsuranceEnrolled: ev.chosen.health || ev.chosen.pension,
    longTermCareEnrolled: ev.longTermCare,
    contractType: input.contractType,
    contractStartDate: ctx.hireDate,
    contractEndDate: input.contractEndDate ?? null,
    renewalExpected: input.renewalExpected,
    probationStartDate: input.probationStartDate ?? null,
    probationEndDate: input.probationEndDate ?? null,
    wageType: input.wageType,
    wageAmount: input.wageAmount,
    monthlyHours: ev.monthlyHours,
    healthInsuranceEnrolled: ev.chosen.health,
    pensionEnrolled: ev.chosen.pension,
    isStudent: input.isStudent,
    ...(overrideReason ? { overrideReason } : {}),
  }, auth);

  const enrolled = ev.chosen.health || ev.chosen.pension;
  await db.runTransaction(async tx => {
    const latest = (await tx.get(ref)).data() as ProcedureDoc;
    requireVersion(latest, input.expectedVersion);
    const now = Timestamp.now();
    let steps = setStep(latest.steps, 'contract', { ...completed(auth.uid), statusDetail: enrolled ? '社会保険に加入' : '社会保険に加入しない' });
    for (const id of INSURANCE_STEPS) {
      steps = setStep(steps, id, enrolled
        ? { status: id === 'filing_create' ? 'available' : 'blocked', referenceType: null, referenceId: null, referenceStatus: null, completedAt: null, completedBy: null, statusDetail: null }
        : { status: 'skipped', statusDetail: '社会保険に加入しないため不要', completedAt: null, completedBy: null });
    }
    steps = setStep(steps, 'confirm', { status: enrolled ? 'blocked' : 'available' });
    tx.update(ref, {
      'onboarding.employmentId': employmentId, 'onboarding.allowances': input.allowances, 'onboarding.inKind': input.inKind,
      steps, statusReason: statusReasonOf(steps), version: latest.version + 1, updatedAt: now,
    });
  });
  return { success: true, employmentId, enrolled };
}

// ── 資格取得届と承認 ───────────────────────────────────

function insuredTypeLabel(e: EmploymentDoc) {
  if (e.insuredCategory === 'shortTime') return '短時間労働者';
  if (e.insuredCategory === 'partTimer') return 'パート';
  return '一般';
}

export async function submitFiling(input: { companyId: string; procedureId: string; expectedVersion: number }, auth: AuthContext) {
  const { ref, proc } = await loadProcedure(input.companyId, input.procedureId, auth);
  requireVersion(proc, input.expectedVersion);
  const ob = proc.onboarding;
  if (stepOf(proc, 'contract').status !== 'completed' || !proc.employeeId || !ob.employmentId) throw invalidArg('先に雇用条件を入れてください');
  if (stepOf(proc, 'filing_create').status === 'skipped') throw invalidArg('社会保険に加入しないため、資格取得届は不要です');
  if (await filingLocked(input.companyId, proc)) throw invalidArg('資格取得届は承認を申請済みです');

  const base = `companies/${input.companyId}`;
  const empPath = `${base}/employees/${proc.employeeId}`;
  const [empSnap, employmentSnap, officeSnap] = await Promise.all([
    db.doc(empPath).get(), db.doc(`${empPath}/employments/${ob.employmentId}`).get(), db.doc(`${base}/offices/${proc.officeId}`).get(),
  ]);
  if (!empSnap.exists || !employmentSnap.exists) throw notFound('従業員または雇用条件');
  const employee = empSnap.data() as EmployeeDoc;
  const employment = employmentSnap.data() as EmploymentDoc;
  const office = (officeSnap.data() ?? {}) as OfficeDoc;

  // 画面の値は使わず、保存済みの雇用条件からサーバーで計算し直す
  const ev = evaluateContract(contractFromEmployment(employment, ob), await contractContext(input.companyId, proc));
  const effectiveMonth = ob.hireDate.slice(0, 7);
  const gradePath = `${empPath}/grades/${effectiveMonth}`;
  const existingGrade = await db.doc(gradePath).get();
  if (existingGrade.exists && existingGrade.data()!.isConfirmed === true) throw invalidArg(`${effectiveMonth}の等級は既に確定しています。従業員台帳で確認してください`);

  const formData = {
    '事業所整理記号': office.officeNumber ?? '',
    '事業所名称': office.name ?? '',
    '被保険者整理番号': employee.insuredPersonNumber ?? '',
    '被保険者氏名': `${employee.lastName} ${employee.firstName}`,
    '被保険者氏名フリガナ': `${employee.lastNameKana} ${employee.firstNameKana}`,
    '生年月日': employee.birthDate ? toDateString(employee.birthDate) : '',
    '性別': employee.gender === 'male' ? '男' : '女',
    '個人番号': '',
    '基礎年金番号': '',
    '届出区分': '資格取得届',
    '資格取得年月日': ob.hireDate,
    '取得区分': ev.chosen.health && ev.chosen.pension ? '健保・厚年' : ev.chosen.health ? '健保のみ' : '厚年のみ',
    '被保険者種別': insuredTypeLabel(employment),
    '報酬月額_通貨': ev.remuneration - ob.inKind,
    '報酬月額_現物': ob.inKind,
    '報酬月額_合計': ev.remuneration,
    '健康保険_等級': ev.chosen.health ? ev.healthGrade.gradeNumber : null,
    '健康保険_標準報酬月額': ev.chosen.health ? ev.healthGrade.standardRemuneration : null,
    '厚生年金_等級': ev.chosen.pension ? ev.pensionGrade.gradeNumber : null,
    '厚生年金_標準報酬月額': ev.chosen.pension ? ev.pensionGrade.standardRemuneration : null,
    '備考': [employment.insuredCategory === 'shortTime' ? '短時間労働者' : '', ...ev.ageNotes].filter(Boolean).join('／'),
  };

  const now = Timestamp.now();
  const filings = db.collection(`${empPath}/filings`);
  let filingRef = ob.filingId ? filings.doc(ob.filingId) : filings.doc();
  const existingFiling = ob.filingId ? await filingRef.get() : null;
  let filingVersion = 1;
  if (existingFiling?.exists) {
    filingVersion = (existingFiling.data()!.version as number) + 1;
    await filingRef.update({ formData, workflowStatus: 'draft', effectiveDate: ob.hireDate, version: filingVersion, updatedAt: now });
  } else {
    filingRef = filings.doc();
    await filingRef.set({
      filingType: 'acquisitionNotification', workflowStatus: 'draft', mockStatus: 'notStarted', submissionStatus: 'notSubmitted',
      effectiveDate: ob.hireDate, formData, submittedAt: null, resultReceivedAt: null, resultNote: null,
      version: 1, createdAt: now, updatedAt: now,
    } satisfies FilingDoc);
  }
  await db.collection(`${base}/auditLogs`).doc().set({
    entity: 'filing', entityId: filingRef.id, action: existingFiling?.exists ? 'update' : 'create',
    changes: { source: { from: null, to: 'onboarding' } }, performedBy: auth.uid, performedAt: now, version: filingVersion,
  });

  const filingId = filingRef.id;
  await db.runTransaction(async tx => {
    const latest = (await tx.get(ref)).data() as ProcedureDoc;
    requireVersion(latest, input.expectedVersion);
    let steps = setStep(latest.steps, 'filing_create', { ...completed(auth.uid), referenceType: 'filing', referenceId: filingId, statusDetail: '作成済み' });
    steps = setStep(steps, 'approval', { status: 'blocked', referenceType: null, referenceId: null, referenceStatus: null, completedAt: null, completedBy: null });
    for (const id of ['mock_filing', 'paper_submit']) steps = setStep(steps, id, { referenceType: 'filing', referenceId: filingId });
    const references = [
      ...latest.references.filter(r => r.type !== 'filing' && r.type !== 'approval'),
      { type: 'filing' as const, documentId: filingId, employeeId: proc.employeeId, documentSubtype: 'acquisitionNotification', stepId: 'filing_create', createdAt: now },
    ];
    tx.update(ref, { 'onboarding.filingId': filingId, steps, references, version: latest.version + 1, updatedAt: now });
  });

  // 承認申請。承認されると届出が承認済みになり、同時に資格取得時決定の等級が確定する
  const { id: requestId } = await createApprovalRequest({
    companyId: input.companyId,
    employeeId: proc.employeeId,
    targetPath: `${empPath}/filings/${filingId}`,
    targetVersion: filingVersion,
    requestType: 'filing',
    comment: `${proc.employeeName}さんの資格取得届（入社日 ${ob.hireDate}）`,
    metadata: {
      source: 'onboarding',
      procedureId: input.procedureId,
      grade: {
        path: gradePath,
        effectiveMonth,
        determinationType: 'initial',
        healthGradeNumber: ev.healthGrade.gradeNumber,
        healthStandardRemuneration: ev.healthGrade.standardRemuneration,
        pensionGradeNumber: ev.pensionGrade.gradeNumber,
        pensionStandardRemuneration: ev.pensionGrade.standardRemuneration,
        basisRemuneration: ev.remuneration,
        reason: `資格取得時決定 報酬月額${ev.remuneration.toLocaleString()}円`,
      },
    },
  }, auth);
  await refreshProcedure(input.companyId, input.procedureId);
  return { success: true, filingId, requestId };
}

// ── 完了 ──────────────────────────────────────────

export async function completeOnboarding(input: { companyId: string; procedureId: string; expectedVersion: number }, auth: AuthContext) {
  const { ref, proc } = await loadProcedure(input.companyId, input.procedureId, auth);
  requireVersion(proc, input.expectedVersion);
  if (stepOf(proc, 'filing_create').status !== 'skipped') {
    return confirmProcedure({ procedureId: input.procedureId, stepId: 'confirm', expectedVersion: input.expectedVersion }, auth);
  }
  if (stepOf(proc, 'contract').status !== 'completed') throw invalidArg('先に雇用条件を入れてください');
  const now = Timestamp.now();
  const steps = setStep(proc.steps, 'confirm', completed(auth.uid));
  await db.runTransaction(async tx => {
    const latest = (await tx.get(ref)).data() as ProcedureDoc;
    requireVersion(latest, input.expectedVersion);
    tx.update(ref, { steps, status: 'completed', statusReason: '社会保険に加入しないため届出なしで完了', completedAt: now, updatedAt: now, version: latest.version + 1 });
    tx.set(db.collection(`companies/${input.companyId}/auditLogs`).doc(), {
      entity: 'procedure', entityId: input.procedureId, action: 'update', changes: { status: { from: latest.status, to: 'completed' } },
      performedBy: auth.uid, performedAt: now, version: latest.version + 1,
    });
  });
  return { success: true, id: input.procedureId };
}

/** まとめて行う操作から外す（保留）。手続きそのものは止めない */
export async function holdOnboarding(input: { companyId: string; procedureId: string; expectedVersion: number; reason: string | null }, auth: AuthContext) {
  const { ref, proc } = await loadProcedure(input.companyId, input.procedureId, auth);
  requireVersion(proc, input.expectedVersion);
  const now = Timestamp.now();
  await ref.update({
    'onboarding.hold': input.reason ? { reason: input.reason, by: auth.uid, at: now } : null,
    version: proc.version + 1, updatedAt: now,
  });
  return { success: true };
}
