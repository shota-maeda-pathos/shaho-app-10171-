import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../config';
import { AuthContext, requireOffice } from '../middleware/auth';
import { EmployeeDoc, EmploymentChangeState, EmploymentDoc, FilingDoc, OfficeDoc, ProcedureDoc } from '../types/firestore';
import { invalidArg, notFound } from '../utils/errors';
import { toDateString } from '../utils/firestore';
import { normalizeEmployment } from '../utils/employment';
import { fiveDayDeadline } from '../insurance/calculator';
import { evaluateContract } from '../onboarding/service';
import { buildEmploymentChangeSteps } from '../procedures/templates';
import { requireProcedureAccess } from '../procedures/access';
import { refreshProcedure } from '../procedures/refresh';
import { completed, latestApprovalId, requireVersion, setStep, statusReasonOf, stepOf, todayJst } from '../procedures/wizard';
import { createApprovalRequest } from '../approvals/approval-request-create/service';
import { confirmProcedure } from '../procedures/procedure-action/service';
import { changeEffect, changeNotes, EFFECT_LABEL, qualificationDateOf } from './rules';
import { ChangeEntryInput, ChangePreviewInput } from './schema';

type ChangeProc = ProcedureDoc & { employmentChange: EmploymentChangeState };
type Entry = Omit<ChangePreviewInput, 'companyId' | 'procedureId'>;

const nameOf = (e: { lastName: string; firstName: string }) => `${e.lastName} ${e.firstName}`;
const FILING_STEPS = ['filing_create', 'approval', 'mock_filing', 'paper_submit'];
const FILING_LABEL = { acquire: '資格取得届', lose: '資格喪失届' } as const;

/** 承認された（effectiveDate を持つ）いちばん新しい雇用条件 */
async function latestEmployment(empPath: string) {
  const snap = await db.collection(`${empPath}/employments`).orderBy('effectiveDate', 'desc').limit(1).get();
  return snap.empty ? null : { id: snap.docs[0].id, doc: snap.docs[0].data() as EmploymentDoc };
}

function summaryOf(doc: EmploymentDoc) {
  const n = normalizeEmployment(doc);
  return {
    employmentType: doc.employmentType, weeklyHours: doc.weeklyHours, monthlyDays: doc.monthlyDays, baseSalary: doc.baseSalary ?? 0,
    contractType: n.contractType, contractEndDate: doc.contractEndDate ?? null,
    health: n.healthInsuranceEnrolled, pension: n.pensionEnrolled, insuredCategory: n.insuredCategory,
  };
}

// ── 開始 ────────────────────────────────────────────

export async function startEmploymentChange(input: { employeeId: string; reason: 'change' | 'renewal' }, auth: AuthContext) {
  const base = `companies/${auth.companyId}`;
  const empPath = `${base}/employees/${input.employeeId}`;
  const empSnap = await db.doc(empPath).get();
  if (!empSnap.exists || empSnap.data()!.deletedAt !== null) throw notFound('従業員');
  const employee = empSnap.data() as EmployeeDoc;
  requireOffice(auth, employee.officeId);
  if (!employee.isActive) throw invalidArg('退職した人の雇用条件は変えられません');

  // 同じ人の進行中の変更があれば、それを開く
  const existing = await db.collection(`${base}/procedures`).where('employeeId', '==', input.employeeId).where('deletedAt', '==', null).get();
  const open = existing.docs.find(d => {
    const p = d.data() as ProcedureDoc;
    return !!p.employmentChange && p.status === 'in_progress';
  });
  if (open) return { procedureId: open.id, existing: true };

  const current = await latestEmployment(empPath);
  if (!current) throw invalidArg('今の雇用条件がありません。入社の手続きで雇用条件を入れてください');
  const name = nameOf(employee);
  const now = Timestamp.now();
  const ref = db.collection(`${base}/procedures`).doc();
  const steps = buildEmploymentChangeSteps();
  const batch = db.batch();
  batch.set(ref, {
    procedureType: 'employment_change',
    title: `${name} ${input.reason === 'renewal' ? '契約の更新' : '雇用条件の変更'}`, priority: 'normal', status: 'in_progress', statusReason: statusReasonOf(steps),
    employeeId: input.employeeId, employeeName: name, officeId: employee.officeId, targetOfficeId: null, scope: 'individual',
    batchMeta: null, invitationId: null, onboardToken: null, steps, deadline: null, effectiveDate: null,
    assignedTo: auth.uid, createdBy: auth.uid, references: [], notes: '', version: 1,
    createdAt: now, updatedAt: now, completedAt: null, deletedAt: null,
    employmentChange: {
      reason: input.reason, effectiveDate: null, input: null, before: summaryOf(current.doc), effect: 'none',
      draftEmploymentId: null, approvalId: null, applied: false, filingId: null,
    },
  } satisfies ProcedureDoc);
  batch.set(db.collection(`${base}/auditLogs`).doc(), {
    entity: 'procedure', entityId: ref.id, action: 'create', changes: { procedureType: { from: null, to: `employment_change:${input.reason}` } },
    performedBy: auth.uid, performedAt: now, version: 1,
  });
  await batch.commit();
  return { procedureId: ref.id, existing: false };
}

// ── 判定 ────────────────────────────────────────────

async function loadProcedure(companyId: string, procedureId: string, auth: AuthContext) {
  const ref = db.doc(`companies/${companyId}/procedures/${procedureId}`);
  const snap = await ref.get();
  if (!snap.exists) throw notFound('手続き');
  const proc = snap.data() as ProcedureDoc;
  requireProcedureAccess(auth, proc);
  if (!proc.employmentChange || !proc.employeeId) throw invalidArg('この手続きは雇用条件の変更の画面では扱えません');
  return { ref, proc: proc as ChangeProc };
}

async function contextOf(companyId: string, proc: ChangeProc, effectiveDate: string) {
  const [emp, office, company] = await Promise.all([
    db.doc(`companies/${companyId}/employees/${proc.employeeId}`).get(),
    db.doc(`companies/${companyId}/offices/${proc.officeId}`).get(),
    db.doc(`companies/${companyId}`).get(),
  ]);
  const employee = emp.data() as EmployeeDoc;
  if (!employee.birthDate) throw invalidArg('生年月日が登録されていません。従業員台帳で生年月日を入れてください');
  const specific = company.exists ? company.data()!.specificApplicableOffice : undefined;
  return {
    employee, office: (office.data() ?? {}) as OfficeDoc,
    ctx: {
      birthDate: toDateString(employee.birthDate), hireDate: effectiveDate,
      office: (office.data() ?? {}) as Partial<OfficeDoc>, specificApplicableOffice: typeof specific === 'boolean' ? specific : null,
    },
  };
}

/** 新しい雇用条件の判定（保存しない）。画面のプレビューと保存で同じ計算を使う */
function judge(entry: Entry, ctx: Parameters<typeof evaluateContract>[1], before: EmploymentChangeState['before']) {
  const ev = evaluateContract(entry, ctx);
  const effect = changeEffect(before ? { health: before.health, pension: before.pension } : null, ev.chosen);
  const baseSalary = entry.wageType === 'monthly' ? entry.wageAmount : ev.remuneration - entry.allowances - entry.inKind;
  const notes = changeNotes({
    effect, enrolledAfter: ev.chosen.health || ev.chosen.pension,
    fixedBefore: before?.baseSalary ?? 0, fixedAfter: baseSalary,
    categoryBefore: before?.insuredCategory ?? 'general', categoryAfter: ev.judgement.insuredCategory ?? 'general',
    contractEndBefore: before?.contractEndDate ?? null, contractEndAfter: entry.contractType === 'fixed' ? entry.contractEndDate ?? null : null,
  });
  return {
    ...ev, effect, effectLabel: EFFECT_LABEL[effect], qualificationDate: qualificationDateOf(effect, entry.effectiveDate),
    baseSalary, notes, fixedWageChanged: (before?.baseSalary ?? 0) !== baseSalary,
  };
}

export async function previewEmploymentChange(input: ChangePreviewInput, auth: AuthContext) {
  const { proc } = await loadProcedure(input.companyId, input.procedureId, auth);
  const { ctx } = await contextOf(input.companyId, proc, input.effectiveDate);
  return judge(input, ctx, proc.employmentChange.before);
}

// ── 読み取り（承認されたら台帳に反映する） ─────────────────

export type ChangeStepKey = 'entry' | 'change_approval' | 'filing' | 'approval' | 'submit' | 'confirm' | 'done';

export function currentChangeStep(proc: ProcedureDoc): ChangeStepKey {
  if (proc.status === 'completed') return 'done';
  const s = (id: string) => stepOf(proc, id);
  if (s('entry').status !== 'completed') return 'entry';
  if (s('change_approval').status !== 'completed') return 'change_approval';
  if (s('filing_create').status === 'skipped') return 'confirm';
  if (s('filing_create').status !== 'completed') return 'filing';
  if (s('approval').status !== 'completed') return 'approval';
  if (s('mock_filing').status !== 'completed' && s('paper_submit').status !== 'completed') return 'submit';
  return 'confirm';
}

/**
 * 雇用条件の承認を見て、承認されていれば台帳に反映する（承認待ちの雇用条件に effectiveDate を付けて有効にする）。
 * 承認の画面から承認されても、次に手続きを開いたときに反映する
 */
async function applyIfApproved(companyId: string, procedureId: string, proc: ChangeProc, uid: string) {
  const ec = proc.employmentChange;
  if (ec.applied || !ec.approvalId || !ec.draftEmploymentId || !ec.effectiveDate) return proc;
  const empPath = `companies/${companyId}/employees/${proc.employeeId}`;
  const approval = (await db.doc(`${empPath}/approvalRequests/${ec.approvalId}`).get()).data();
  if (approval?.status !== 'approved') return proc;
  const ref = db.doc(`companies/${companyId}/procedures/${procedureId}`);
  await db.runTransaction(async tx => {
    const latest = (await tx.get(ref)).data() as ChangeProc;
    if (latest.employmentChange.applied) return;
    const draftRef = db.doc(`${empPath}/employments/${ec.draftEmploymentId}`);
    const draft = (await tx.get(draftRef)).data() as EmploymentDoc & { plannedEffectiveDate?: string };
    const now = Timestamp.now();
    tx.update(draftRef, { effectiveDate: draft.plannedEffectiveDate ?? ec.effectiveDate, updatedAt: now });
    tx.update(db.doc(empPath), {
      contract: { type: draft.contractType ?? 'indefinite', endDate: draft.contractEndDate ?? null, renewalExpected: draft.renewalExpected ?? false },
      updatedAt: now,
    });
    let steps = setStep(latest.steps, 'change_approval', { ...completed(approval.reviewedBy ?? uid), statusDetail: `${ec.effectiveDate}から有効` });
    for (const id of FILING_STEPS) {
      steps = setStep(steps, id, latest.employmentChange.effect === 'none'
        ? { status: 'skipped', statusDetail: '加入が変わらないため不要' }
        : { status: id === 'filing_create' ? 'available' : 'blocked' });
    }
    steps = setStep(steps, 'confirm', { status: latest.employmentChange.effect === 'none' ? 'available' : 'blocked' });
    tx.update(ref, { 'employmentChange.applied': true, steps, statusReason: statusReasonOf(steps), version: latest.version + 1, updatedAt: now });
    tx.set(db.collection(`companies/${companyId}/auditLogs`).doc(), {
      entity: 'employment', entityId: ec.draftEmploymentId, action: 'update', changes: { effectiveDate: { from: null, to: ec.effectiveDate } },
      note: '雇用条件の変更の承認で有効にした', performedBy: uid, performedAt: now, version: 1,
    });
  });
  return (await ref.get()).data() as ChangeProc;
}

export async function getEmploymentChange(companyId: string, procedureId: string, auth: AuthContext) {
  let { proc } = await loadProcedure(companyId, procedureId, auth);
  if (proc.status === 'in_progress') proc = await applyIfApproved(companyId, procedureId, proc, auth.uid);
  if (proc.status === 'in_progress' && proc.employmentChange.filingId) {
    proc = (await refreshProcedure(companyId, procedureId)).procedure as ChangeProc;
  }
  const ec = proc.employmentChange;
  const base = `companies/${companyId}`;
  const empPath = `${base}/employees/${proc.employeeId}`;
  const filingApprovalId = latestApprovalId(proc);
  const [empSnap, officeSnap, changeApproval, filingSnap, filingApproval] = await Promise.all([
    db.doc(empPath).get(),
    db.doc(`${base}/offices/${proc.officeId}`).get(),
    ec.approvalId ? db.doc(`${empPath}/approvalRequests/${ec.approvalId}`).get() : null,
    ec.filingId ? db.doc(`${empPath}/filings/${ec.filingId}`).get() : null,
    filingApprovalId ? db.doc(`${empPath}/approvalRequests/${filingApprovalId}`).get() : null,
  ]);
  const e = empSnap.data() as EmployeeDoc;
  const filing = filingSnap?.exists ? filingSnap.data() as FilingDoc : null;
  const status = (s: FirebaseFirestore.DocumentSnapshot | null) => s?.exists ? { status: s.data()!.status as string, comment: (s.data()!.comment ?? null) as string | null } : null;
  return {
    procedure: {
      id: procedureId, version: proc.version, status: proc.status, title: proc.title, reason: ec.reason,
      officeId: proc.officeId, officeName: (officeSnap.data()?.name as string) ?? '', employeeName: proc.employeeName,
    },
    current: currentChangeStep(proc),
    steps: proc.steps.map(s => ({ id: s.id, label: s.label, status: s.status, statusDetail: s.statusDetail })),
    employee: { id: proc.employeeId!, employeeNumber: e.employeeNumber, name: nameOf(e), otherEmployer: e.otherEmployer?.name ?? null },
    before: ec.before,
    effectiveDate: ec.effectiveDate,
    input: ec.input,
    effect: ec.effect,
    effectLabel: EFFECT_LABEL[ec.effect],
    qualificationDate: ec.effectiveDate ? qualificationDateOf(ec.effect, ec.effectiveDate) : null,
    applied: ec.applied,
    changeApproval: status(changeApproval),
    filingLabel: ec.effect === 'none' ? '' : FILING_LABEL[ec.effect],
    filing: filing && ec.filingId ? {
      id: ec.filingId, version: filing.version, workflowStatus: filing.workflowStatus,
      mockStatus: filing.mockStatus, submissionStatus: filing.submissionStatus, resultNote: filing.resultNote,
    } : null,
    approval: status(filingApproval),
  };
}

// ── 新しい雇用条件を入れる ───────────────────────────────

export async function saveEmploymentEntry(input: ChangeEntryInput, auth: AuthContext) {
  const { ref, proc } = await loadProcedure(input.companyId, input.procedureId, auth);
  requireVersion(proc, input.expectedVersion);
  const ec = proc.employmentChange;
  const empPath = `companies/${input.companyId}/employees/${proc.employeeId}`;
  if (ec.applied) throw invalidArg('雇用条件は承認されて台帳に反映済みです。さらに変える場合は、新しく雇用条件の変更を始めてください');
  if (ec.approvalId) {
    const a = (await db.doc(`${empPath}/approvalRequests/${ec.approvalId}`).get()).data();
    if (a?.status === 'pending') throw invalidArg('承認を依頼済みです。直す場合は承認者に差し戻してもらってください');
  }
  const current = await latestEmployment(empPath);
  if (current && input.effectiveDate <= current.doc.effectiveDate) throw invalidArg(`新しい条件の初日は、今の雇用条件の開始日（${current.doc.effectiveDate}）より後にしてください`);
  if (input.contractType === 'fixed' && !input.contractEndDate) throw invalidArg('有期契約の終わりの日を入れてください');
  if (input.contractEndDate && input.contractEndDate < input.effectiveDate) throw invalidArg('契約の終わりの日が、新しい条件の初日より前になっています');

  const { ctx } = await contextOf(input.companyId, proc, input.effectiveDate);
  const j = judge(input, ctx, ec.before);
  let overrideReason = input.overrideReason;
  if (j.needsReason && !overrideReason) {
    const onlyAge = j.judgement.result === 'applicable' && j.chosen.health === j.expected.health && j.chosen.pension === j.expected.pension;
    if (!onlyAge) throw invalidArg(`加入の判定（${j.judgement.reason}）と異なる加入区分にする場合は理由を入力してください`);
    overrideReason = j.ageNotes.join('／');
  }

  // 前に入れた承認待ちの雇用条件（差し戻されたもの）は消して作り直す
  if (ec.draftEmploymentId) await db.doc(`${empPath}/employments/${ec.draftEmploymentId}`).delete();
  const now = Timestamp.now();
  const draftRef = db.collection(`${empPath}/employments`).doc();
  // 承認されるまでは effectiveDate を持たせない（日付で探す計算・判定から見えないようにする）
  await draftRef.set({
    plannedEffectiveDate: input.effectiveDate,
    employmentType: input.employmentType, weeklyHours: input.weeklyHours, monthlyDays: input.monthlyDays, baseSalary: j.baseSalary,
    socialInsuranceEnrolled: j.chosen.health || j.chosen.pension, longTermCareEnrolled: j.longTermCare, note: input.note,
    contractType: input.contractType, contractStartDate: input.effectiveDate, contractEndDate: input.contractType === 'fixed' ? input.contractEndDate ?? null : null,
    renewalExpected: input.renewalExpected, weeklyDays: null,
    workStyle: j.judgement.insuredCategory === 'shortTime' ? 'shortTime' : ['partTime', 'arbeit'].includes(input.employmentType) ? 'partTime' : 'fullTime',
    // 試用期間は雇用条件の変更で変えないので、今の雇用条件から引き継ぐ
    probationStartDate: current?.doc.probationStartDate ?? null, probationEndDate: current?.doc.probationEndDate ?? null, wageType: input.wageType, wageAmount: input.wageAmount, monthlyHours: j.monthlyHours,
    healthInsuranceEnrolled: j.chosen.health, pensionEnrolled: j.chosen.pension,
    applicabilityReason: j.chosen.health || j.chosen.pension ? 'standard' : 'excluded',
    insuredCategory: j.judgement.insuredCategory ?? 'general', isStudent: input.isStudent,
    applicabilityJudgement: { result: j.judgement.result, reason: j.judgement.reason },
    applicabilityOverride: overrideReason ? { reason: overrideReason, by: auth.uid } : null,
    allowances: input.allowances, inKind: input.inKind,
    employmentChangeProcedureId: input.procedureId, isConfirmed: false,
    version: 1, createdAt: now, updatedAt: now,
  });
  const { id: approvalId } = await createApprovalRequest({
    companyId: input.companyId,
    employeeId: proc.employeeId!,
    targetPath: draftRef.path,
    targetVersion: 1,
    requestType: 'employment',
    comment: `${proc.employeeName}さんの雇用条件の変更（${input.effectiveDate}から）：${j.effectLabel}`,
    metadata: { source: 'employmentChange', procedureId: input.procedureId },
  }, auth);

  // 指定のない項目（undefined）は Firestore に書けないため落とす
  const { companyId: _c, procedureId: _p, expectedVersion: _v, ...rest } = input;
  const entry = JSON.parse(JSON.stringify(rest)) as Record<string, unknown>;
  await db.runTransaction(async tx => {
    const latest = (await tx.get(ref)).data() as ChangeProc;
    requireVersion(latest, input.expectedVersion);
    let steps = setStep(latest.steps, 'entry', { ...completed(auth.uid), statusDetail: `${input.effectiveDate}から・${j.effectLabel}` });
    steps = setStep(steps, 'change_approval', { status: 'in_progress', statusDetail: '承認待ち', completedAt: null, completedBy: null });
    tx.update(ref, {
      'employmentChange.effectiveDate': input.effectiveDate,
      'employmentChange.input': { ...entry, overrideReason: overrideReason ?? null },
      'employmentChange.effect': j.effect,
      'employmentChange.draftEmploymentId': draftRef.id,
      'employmentChange.approvalId': approvalId,
      steps, statusReason: statusReasonOf(steps),
      effectiveDate: Timestamp.fromDate(new Date(`${input.effectiveDate}T00:00:00Z`)),
      deadline: j.qualificationDate ? Timestamp.fromDate(new Date(`${fiveDayDeadline(j.qualificationDate)}T00:00:00Z`)) : null,
      version: latest.version + 1, updatedAt: now,
    });
  });
  return { success: true, effect: j.effect, approvalId };
}

// ── 届出 ────────────────────────────────────────────

export async function submitChangeFiling(input: { companyId: string; procedureId: string; expectedVersion: number }, auth: AuthContext) {
  const { ref, proc } = await loadProcedure(input.companyId, input.procedureId, auth);
  requireVersion(proc, input.expectedVersion);
  const ec = proc.employmentChange;
  if (!ec.applied || ec.effect === 'none' || !ec.effectiveDate || !ec.input) throw invalidArg('届出はいりません');
  const empPath = `companies/${input.companyId}/employees/${proc.employeeId}`;
  const filingApprovalId = latestApprovalId(proc);
  if (filingApprovalId) {
    const a = (await db.doc(`${empPath}/approvalRequests/${filingApprovalId}`).get()).data();
    if (a?.status === 'pending' || a?.status === 'approved') throw invalidArg('届出は承認を申請済みです');
  }
  const { employee: e, office, ctx } = await contextOf(input.companyId, proc, ec.effectiveDate);
  const j = judge(ec.input as Entry, ctx, ec.before);
  const qualificationDate = qualificationDateOf(ec.effect, ec.effectiveDate)!;
  const common = {
    '事業所整理記号': office.officeNumber ?? '', '事業所名称': office.name ?? '',
    '被保険者整理番号': e.insuredPersonNumber ?? '', '被保険者氏名': nameOf(e), '被保険者氏名フリガナ': `${e.lastNameKana} ${e.firstNameKana}`,
    '生年月日': e.birthDate ? toDateString(e.birthDate) : '', '性別': e.gender === 'male' ? '男' : '女', '個人番号': '', '基礎年金番号': '',
  };
  const acquire = ec.effect === 'acquire';
  const effectiveMonth = qualificationDate.slice(0, 7);
  const formData = acquire ? {
    ...common,
    '届出区分': '資格取得届', '資格取得年月日': qualificationDate,
    '取得区分': j.chosen.health && j.chosen.pension ? '健保・厚年' : j.chosen.health ? '健保のみ' : '厚年のみ',
    '被保険者種別': j.judgement.insuredCategory === 'shortTime' ? '短時間労働者' : j.judgement.insuredCategory === 'partTimer' ? 'パート' : '一般',
    '報酬月額_通貨': j.remuneration - (ec.input as Entry).inKind, '報酬月額_現物': (ec.input as Entry).inKind, '報酬月額_合計': j.remuneration,
    '健康保険_等級': j.chosen.health ? j.healthGrade.gradeNumber : null, '健康保険_標準報酬月額': j.chosen.health ? j.healthGrade.standardRemuneration : null,
    '厚生年金_等級': j.chosen.pension ? j.pensionGrade.gradeNumber : null, '厚生年金_標準報酬月額': j.chosen.pension ? j.pensionGrade.standardRemuneration : null,
    '備考': '労働条件の変更による取得',
  } : {
    ...common,
    '届出区分': '資格喪失届', '資格喪失年月日': qualificationDate, '喪失原因': '退職等', '退職年月日': ec.effectiveDate,
    '喪失する保険': ec.before?.health && ec.before?.pension ? '健保・厚年' : ec.before?.health ? '健保のみ' : '厚年のみ',
    '保険証回収_添付': 0, '保険証回収_返不能': 0,
    '備考': '労働条件の変更（適用除外）による喪失',
  };
  if (acquire) {
    const existingGrade = await db.doc(`${empPath}/grades/${effectiveMonth}`).get();
    if (existingGrade.exists) throw invalidArg(`${effectiveMonth}の等級は既に決まっています。従業員台帳で確認してください`);
  }

  const now = Timestamp.now();
  const filings = db.collection(`${empPath}/filings`);
  const existing = ec.filingId ? await filings.doc(ec.filingId).get() : null;
  const filingRef = existing?.exists ? existing.ref : filings.doc();
  let filingVersion = 1;
  const filingType = acquire ? 'acquisitionNotification' : 'lossNotification';
  if (existing?.exists) {
    filingVersion = (existing.data()!.version as number) + 1;
    await filingRef.update({ formData, workflowStatus: 'draft', effectiveDate: qualificationDate, version: filingVersion, updatedAt: now });
  } else {
    await filingRef.set({
      filingType, workflowStatus: 'draft', mockStatus: 'notStarted', submissionStatus: 'notSubmitted',
      effectiveDate: qualificationDate, formData, submittedAt: null, resultReceivedAt: null, resultNote: null, version: 1, createdAt: now, updatedAt: now,
    } satisfies FilingDoc);
  }
  const filingId = filingRef.id;
  await db.runTransaction(async tx => {
    const latest = (await tx.get(ref)).data() as ChangeProc;
    requireVersion(latest, input.expectedVersion);
    let steps = setStep(latest.steps, 'filing_create', {
      ...completed(auth.uid), label: `${FILING_LABEL[ec.effect as 'acquire' | 'lose']}を作る`, referenceType: 'filing', referenceId: filingId, statusDetail: '作成済み',
    });
    steps = setStep(steps, 'approval', { status: 'blocked', referenceType: null, referenceId: null, referenceStatus: null, completedAt: null, completedBy: null });
    for (const id of ['mock_filing', 'paper_submit']) steps = setStep(steps, id, { referenceType: 'filing', referenceId: filingId });
    const references = [
      ...latest.references.filter(r => r.type !== 'filing' && r.type !== 'approval'),
      { type: 'filing' as const, documentId: filingId, employeeId: proc.employeeId, documentSubtype: filingType, stepId: 'filing_create', createdAt: now },
    ];
    tx.update(ref, { 'employmentChange.filingId': filingId, steps, references, version: latest.version + 1, updatedAt: now });
  });
  // 加入するときは資格取得時決定の等級も、届出の承認で確定する（入社と同じ）
  const { id: requestId } = await createApprovalRequest({
    companyId: input.companyId,
    employeeId: proc.employeeId!,
    targetPath: `${empPath}/filings/${filingId}`,
    targetVersion: filingVersion,
    requestType: 'filing',
    comment: `${proc.employeeName}さんの${FILING_LABEL[ec.effect as 'acquire' | 'lose']}（労働条件の変更、${qualificationDate}）`,
    metadata: {
      source: 'employmentChange', procedureId: input.procedureId,
      ...(acquire ? { grade: {
        path: `${empPath}/grades/${effectiveMonth}`, effectiveMonth, determinationType: 'initial',
        healthGradeNumber: j.healthGrade.gradeNumber, healthStandardRemuneration: j.healthGrade.standardRemuneration,
        pensionGradeNumber: j.pensionGrade.gradeNumber, pensionStandardRemuneration: j.pensionGrade.standardRemuneration,
        basisRemuneration: j.remuneration, reason: `資格取得時決定（労働条件の変更） 報酬月額${j.remuneration.toLocaleString('ja-JP')}円`,
      } } : {}),
    },
  }, auth);
  await refreshProcedure(input.companyId, input.procedureId);
  return { success: true, filingId, requestId };
}

// ── 完了 ────────────────────────────────────────────

export async function completeEmploymentChange(input: { companyId: string; procedureId: string; expectedVersion: number }, auth: AuthContext) {
  const { ref, proc } = await loadProcedure(input.companyId, input.procedureId, auth);
  requireVersion(proc, input.expectedVersion);
  if (stepOf(proc, 'confirm').status !== 'available') throw invalidArg('承認と届出の提出が済んでから完了にしてください');
  if (stepOf(proc, 'filing_create').status !== 'skipped') {
    return confirmProcedure({ procedureId: input.procedureId, stepId: 'confirm', expectedVersion: proc.version }, auth);
  }
  const now = Timestamp.now();
  const steps = setStep(proc.steps, 'confirm', completed(auth.uid));
  await db.runTransaction(async tx => {
    const latest = (await tx.get(ref)).data() as ChangeProc;
    requireVersion(latest, input.expectedVersion);
    tx.update(ref, { steps, status: 'completed', statusReason: '雇用条件を変更した（届出なし）', completedAt: now, updatedAt: now, version: latest.version + 1 });
  });
  return { success: true, today: todayJst() };
}
