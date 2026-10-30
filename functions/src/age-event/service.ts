import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../config';
import { AuthContext, requireOffice } from '../middleware/auth';
import { AgeEventState, EmployeeDoc, EmploymentDoc, FilingDoc, GradeDoc, OfficeDoc, ProcedureDoc, SalaryDoc } from '../types/firestore';
import { invalidArg, notFound } from '../utils/errors';
import { toDateString, toTimestamp } from '../utils/firestore';
import { normalizeEmployment } from '../utils/employment';
import { findApplicableRate } from '../utils/insurance-rate';
import { addMonths, monthOf, resolveGradeTable } from '../insurance/calculator';
import { buildAgeWizardSteps } from '../procedures/templates';
import { requireProcedureAccess } from '../procedures/access';
import { refreshProcedure } from '../procedures/refresh';
import { completed, latestApprovalId, requireVersion, setStep, statusReasonOf, stepOf, todayJst } from '../procedures/wizard';
import { createApprovalRequest } from '../approvals/approval-request-create/service';
import { confirmProcedure } from '../procedures/procedure-action/service';
import {
  AGE_OF, AgeEventKind, deadlineOf, FILING_LABEL, FILING_TYPE, KIND_LABEL, milestoneFacts, pension70Filing, remunerationEstimate,
} from './rules';
import { AgeCheckInput } from './schema';

type AgeProc = ProcedureDoc & { ageEvent: AgeEventState };

const nameOf = (e: { lastName: string; firstName: string }) => `${e.lastName} ${e.firstName}`;
const FILING_STEPS = ['filing_create', 'approval', 'mock_filing', 'paper_submit'];

// ── 開始 ────────────────────────────────────────────

export async function startAgeEvent(input: { employeeId: string; kind: AgeEventKind }, auth: AuthContext) {
  const base = `companies/${auth.companyId}`;
  const empPath = `${base}/employees/${input.employeeId}`;
  const [empSnap, employmentSnap] = await Promise.all([
    db.doc(empPath).get(),
    db.collection(`${empPath}/employments`).orderBy('effectiveDate', 'desc').limit(1).get(),
  ]);
  if (!empSnap.exists || empSnap.data()!.deletedAt !== null) throw notFound('従業員');
  const employee = empSnap.data() as EmployeeDoc;
  requireOffice(auth, employee.officeId);
  if (!employee.birthDate) throw invalidArg('生年月日が登録されていません。従業員の基本情報で入れてください');
  const birthDate = toDateString(employee.birthDate);
  const facts = milestoneFacts(birthDate, AGE_OF[input.kind]);

  // 1人に1回しか起きないので、同じ種類の手続きがあれば（終えたものも）それを開く
  const existing = await db.collection(`${base}/procedures`).where('employeeId', '==', input.employeeId).where('deletedAt', '==', null).get();
  const found = existing.docs.find(d => {
    const p = d.data() as ProcedureDoc;
    return p.ageEvent?.kind === input.kind && p.status !== 'cancelled';
  });
  if (found) return { procedureId: found.id, existing: true };

  if (!employee.isActive) throw invalidArg('退職した人の年齢到達の手続きはありません');
  const employment = employmentSnap.empty ? null : normalizeEmployment(employmentSnap.docs[0].data() as EmploymentDoc);
  const enrolled = input.kind === 'pension70' ? employment?.pensionEnrolled ?? true : employment?.healthInsuranceEnrolled ?? true;
  if (!enrolled) throw invalidArg(input.kind === 'pension70' ? '厚生年金に加入していないため、70歳到達の届出はありません' : '健康保険に加入していないため、75歳到達の届出はありません');
  // 3か月より先の到達は、まだ始めない（報酬月額や回収枚数が決まらない）
  if (facts.eventDate > addMonths(todayJst().slice(0, 7), 3) + '-31') throw invalidArg(`${facts.eventDate}に起きる年齢到達です。近くなってから始めてください`);

  const name = nameOf(employee);
  const now = Timestamp.now();
  const ref = db.collection(`${base}/procedures`).doc();
  const steps = buildAgeWizardSteps();
  const batch = db.batch();
  batch.set(ref, {
    procedureType: 'age_event',
    title: `${name} ${KIND_LABEL[input.kind]}`, priority: 'normal', status: 'in_progress', statusReason: statusReasonOf(steps),
    employeeId: input.employeeId, employeeName: name, officeId: employee.officeId, targetOfficeId: null, scope: 'individual',
    batchMeta: null, invitationId: null, onboardToken: null, steps,
    deadline: toTimestamp(deadlineOf(facts.eventDate)), effectiveDate: toTimestamp(facts.eventDate),
    assignedTo: auth.uid, createdBy: auth.uid, references: [], notes: '', version: 1,
    createdAt: now, updatedAt: now, completedAt: null, deletedAt: null,
    ageEvent: {
      kind: input.kind, birthDate, reachDate: facts.reachDate, lossDate: facts.eventDate,
      remuneration: null, inKind: 0, filingRequired: input.kind === 'health75' ? true : null, equivalentGrade: null, equivalentStandard: null,
      cardsReturned: 0, cardsUnreturnable: 0, filingId: null,
    },
  } satisfies ProcedureDoc);
  batch.set(db.collection(`${base}/auditLogs`).doc(), {
    entity: 'procedure', entityId: ref.id, action: 'create', changes: { procedureType: { from: null, to: `age_event:${input.kind}` } },
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
  if (!proc.ageEvent || !proc.employeeId) throw invalidArg('この手続きは年齢到達の画面では扱えません');
  return { ref, proc: proc as AgeProc };
}

export type AgeStepKey = 'check' | 'filing' | 'approval' | 'submit' | 'confirm' | 'done';

export function currentAgeStep(proc: ProcedureDoc): AgeStepKey {
  if (proc.status === 'completed') return 'done';
  const s = (id: string) => stepOf(proc, id);
  if (s('check').status !== 'completed') return 'check';
  if (s('filing_create').status === 'skipped') return 'confirm';
  if (s('filing_create').status !== 'completed') return 'filing';
  if (s('approval').status !== 'completed') return 'approval';
  if (s('mock_filing').status !== 'completed' && s('paper_submit').status !== 'completed') return 'submit';
  return 'confirm';
}

/** 判定に使う台帳の内容（到達前の等級・直近の給与・厚年の等級表・被扶養者） */
async function contextOf(companyId: string, proc: AgeProc) {
  const base = `companies/${companyId}`;
  const empPath = `${base}/employees/${proc.employeeId}`;
  const ae = proc.ageEvent;
  // 到達前の等級：資格を失う日の前日に適用されている等級
  const before = addMonths(monthOf(ae.lossDate), ae.lossDate.endsWith('-01') ? -1 : 0);
  const [empSnap, officeSnap, gradeSnap, salarySnap, dependentSnap] = await Promise.all([
    db.doc(empPath).get(),
    db.doc(`${base}/offices/${proc.officeId}`).get(),
    db.collection(`${empPath}/grades`).where('effectiveMonth', '<=', before).orderBy('effectiveMonth', 'desc').limit(1).get(),
    db.collection(`${empPath}/salaries`).where('yearMonth', '<=', monthOf(ae.lossDate)).orderBy('yearMonth', 'desc').limit(4).get(),
    ae.kind === 'health75' ? db.collection(`${empPath}/dependents`).get() : null,
  ]);
  const pensionRate = await findApplicableRate({ companyId, insuranceType: 'pension', yearMonth: monthOf(ae.lossDate) });
  const salaries = salarySnap.docs.map(d => d.data() as SalaryDoc & { noPay?: boolean }).filter(s => s.isConfirmed && !s.noPay);
  const dependents = (dependentSnap?.docs ?? []).map(d => d.data()).filter(d => d.certification !== 'removed' && !d.disqualificationDate && d.deletedAt == null);
  return {
    employee: empSnap.data() as EmployeeDoc,
    office: (officeSnap.data() ?? {}) as OfficeDoc,
    grade: gradeSnap.empty ? null : gradeSnap.docs[0].data() as GradeDoc,
    estimate: remunerationEstimate(salaries.map(s => ({ totalFixedWage: s.totalFixedWage ?? 0, totalVariableWage: s.totalVariableWage ?? 0, inKind: s.inKindAmount ?? 0 }))),
    latestSalaryMonth: salaries[0]?.yearMonth ?? null,
    pensionTable: resolveGradeTable('pension', pensionRate?.gradeTable),
    dependents: dependents.map(d => `${d.lastName ?? ''} ${d.firstName ?? ''}`.trim()),
  };
}

async function filingLocked(companyId: string, proc: AgeProc) {
  const empPath = `companies/${companyId}/employees/${proc.employeeId}`;
  if (proc.ageEvent.filingId) {
    const f = await db.doc(`${empPath}/filings/${proc.ageEvent.filingId}`).get();
    if (f.exists && f.data()!.workflowStatus === 'approved') return true;
  }
  const approvalId = latestApprovalId(proc);
  if (!approvalId) return false;
  const a = await db.doc(`${empPath}/approvalRequests/${approvalId}`).get();
  return a.exists && a.data()!.status === 'pending';
}

export async function getAgeEvent(companyId: string, procedureId: string, auth: AuthContext) {
  let { proc } = await loadProcedure(companyId, procedureId, auth);
  if (proc.status === 'in_progress' && proc.ageEvent.filingId) {
    proc = (await refreshProcedure(companyId, procedureId)).procedure as AgeProc;
  }
  const ae = proc.ageEvent;
  const empPath = `companies/${companyId}/employees/${proc.employeeId}`;
  const approvalId = latestApprovalId(proc);
  const [ctx, filingSnap, approvalSnap] = await Promise.all([
    contextOf(companyId, proc),
    ae.filingId ? db.doc(`${empPath}/filings/${ae.filingId}`).get() : null,
    approvalId ? db.doc(`${empPath}/approvalRequests/${approvalId}`).get() : null,
  ]);
  const filing = filingSnap?.exists ? filingSnap.data() as FilingDoc : null;
  const facts = milestoneFacts(ae.birthDate, AGE_OF[ae.kind]);
  return {
    procedure: {
      id: procedureId, version: proc.version, status: proc.status, title: proc.title, kind: ae.kind, kindLabel: KIND_LABEL[ae.kind],
      officeId: proc.officeId, officeName: ctx.office.name ?? '', employeeName: proc.employeeName,
    },
    current: currentAgeStep(proc),
    steps: proc.steps.map(s => ({ id: s.id, label: s.label, status: s.status, statusDetail: s.statusDetail })),
    employee: { id: proc.employeeId!, employeeNumber: ctx.employee.employeeNumber, name: nameOf(ctx.employee), birthDate: ae.birthDate, otherEmployer: ctx.employee.otherEmployer?.name ?? null },
    facts: {
      reachDate: ae.reachDate, lossDate: ae.lossDate, effect: facts.effect,
      lastChargedMonth: addMonths(facts.changeMonth, -1), deadline: deadlineOf(ae.lossDate),
    },
    state: {
      remuneration: ae.remuneration, inKind: ae.inKind, filingRequired: ae.filingRequired,
      equivalentGrade: ae.equivalentGrade, equivalentStandard: ae.equivalentStandard,
      cardsReturned: ae.cardsReturned, cardsUnreturnable: ae.cardsUnreturnable,
    },
    grade: ctx.grade ? {
      effectiveMonth: ctx.grade.effectiveMonth, healthGrade: ctx.grade.healthGradeNumber, healthStandard: ctx.grade.healthStandardRemuneration,
      pensionGrade: ctx.grade.pensionGradeNumber, pensionStandard: ctx.grade.pensionStandardRemuneration,
    } : null,
    estimate: ctx.estimate, latestSalaryMonth: ctx.latestSalaryMonth,
    dependents: ctx.dependents,
    filingLabel: FILING_LABEL[ae.kind],
    filing: filing && ae.filingId ? {
      id: ae.filingId, version: filing.version, workflowStatus: filing.workflowStatus,
      mockStatus: filing.mockStatus, submissionStatus: filing.submissionStatus, resultNote: filing.resultNote,
    } : null,
    approval: approvalSnap?.exists ? { status: approvalSnap.data()!.status as string, comment: (approvalSnap.data()!.comment ?? null) as string | null } : null,
    locked: await filingLocked(companyId, proc),
  };
}

export async function previewAgeEvent(input: { companyId: string; procedureId: string; remuneration: number | null }, auth: AuthContext) {
  const { proc } = await loadProcedure(input.companyId, input.procedureId, auth);
  if (proc.ageEvent.kind !== 'pension70') return null;
  const ctx = await contextOf(input.companyId, proc);
  return pension70Filing({ remuneration: input.remuneration, currentPensionStandard: ctx.grade?.pensionStandardRemuneration ?? null, pensionTable: ctx.pensionTable });
}

// ── 確かめる ───────────────────────────────────────

export async function saveAgeCheck(input: AgeCheckInput, auth: AuthContext) {
  const { ref, proc } = await loadProcedure(input.companyId, input.procedureId, auth);
  requireVersion(proc, input.expectedVersion);
  if (await filingLocked(input.companyId, proc)) throw invalidArg('届出の承認を依頼済みです。直す場合は承認者に差し戻してもらってください');
  const ae = proc.ageEvent;
  let patch: Record<string, unknown>;
  let detail: string;
  let filingRequired = true;
  if (ae.kind === 'pension70') {
    const ctx = await contextOf(input.companyId, proc);
    const r = pension70Filing({ remuneration: input.remuneration, currentPensionStandard: ctx.grade?.pensionStandardRemuneration ?? null, pensionTable: ctx.pensionTable });
    if (r.filingRequired === null) throw invalidArg(r.message);
    if (input.inKind > (input.remuneration ?? 0)) throw invalidArg('現物給与が報酬月額より多くなっています');
    filingRequired = r.filingRequired;
    patch = {
      'ageEvent.remuneration': input.remuneration, 'ageEvent.inKind': input.inKind, 'ageEvent.filingRequired': r.filingRequired,
      'ageEvent.equivalentGrade': r.equivalentGrade, 'ageEvent.equivalentStandard': r.equivalentStandard,
    };
    detail = r.filingRequired ? `相当額 ${r.equivalentStandard!.toLocaleString('ja-JP')}円（届出あり）` : '相当額が同じ（届出なし）';
  } else {
    patch = { 'ageEvent.cardsReturned': input.cardsReturned, 'ageEvent.cardsUnreturnable': input.cardsUnreturnable };
    detail = `喪失日 ${ae.lossDate}`;
  }

  await db.runTransaction(async tx => {
    const latest = (await tx.get(ref)).data() as AgeProc;
    requireVersion(latest, input.expectedVersion);
    const now = Timestamp.now();
    const clear = { referenceType: null, referenceId: null, referenceStatus: null, completedAt: null, completedBy: null, statusDetail: null, actionLabel: null, actionRoute: null };
    let steps = setStep(latest.steps, 'check', { ...completed(auth.uid), statusDetail: detail });
    // 確かめ直したら届出から作り直す。届出が要らなければ届出のステップを飛ばして完了の確認へ
    for (const id of FILING_STEPS) {
      steps = setStep(steps, id, filingRequired
        ? { ...clear, status: id === 'filing_create' ? 'available' : 'blocked' }
        : { ...clear, status: 'skipped', statusDetail: '届出は不要' });
    }
    steps = setStep(steps, 'confirm', { status: filingRequired ? 'blocked' : 'available', completedAt: null, completedBy: null });
    tx.update(ref, {
      ...patch,
      references: latest.references.filter(r => r.type !== 'approval'),
      steps, statusReason: statusReasonOf(steps),
      // 届出が要らなければ期限は関係ない
      deadline: filingRequired ? toTimestamp(deadlineOf(ae.lossDate)) : null,
      version: latest.version + 1, updatedAt: now,
    });
  });
  return { success: true, filingRequired };
}

// ── 届出と承認 ─────────────────────────────────────

function formDataOf(proc: AgeProc, e: EmployeeDoc, office: OfficeDoc, grade: GradeDoc | null) {
  const ae = proc.ageEvent;
  const common = {
    '事業所整理記号': office.officeNumber ?? '',
    '事業所名称': office.name ?? '',
    '被保険者整理番号': e.insuredPersonNumber ?? '',
    '被保険者氏名': nameOf(e),
    '被保険者氏名フリガナ': `${e.lastNameKana} ${e.firstNameKana}`,
    '生年月日': ae.birthDate,
    '性別': e.gender === 'male' ? '男' : '女',
    '個人番号': '',
    '基礎年金番号': '',
    '資格喪失年月日': ae.lossDate,
  };
  if (ae.kind === 'health75') {
    return {
      ...common,
      '届出区分': '資格喪失届',
      '喪失原因': '75歳到達',
      '喪失する保険': '健保のみ',
      '最終標準報酬月額_健康保険': grade?.healthStandardRemuneration ?? null,
      '保険証回収_添付': ae.cardsReturned,
      '保険証回収_返不能': ae.cardsUnreturnable,
      '備考': '',
    };
  }
  const total = ae.remuneration ?? 0;
  return {
    ...common,
    '届出区分': '資格喪失届・70歳以上被用者該当届',
    '喪失原因': '70歳到達',
    '従前の標準報酬月額_厚生年金': grade?.pensionStandardRemuneration ?? null,
    '該当年月日': ae.reachDate,
    '報酬月額_通貨': total - ae.inKind,
    '報酬月額_現物': ae.inKind,
    '報酬月額_合計': total,
    '標準報酬月額相当額': ae.equivalentStandard,
    '備考': '',
  };
}

export async function submitAgeFiling(input: { companyId: string; procedureId: string; expectedVersion: number }, auth: AuthContext) {
  const { ref, proc } = await loadProcedure(input.companyId, input.procedureId, auth);
  requireVersion(proc, input.expectedVersion);
  const ae = proc.ageEvent;
  if (stepOf(proc, 'check').status !== 'completed') throw invalidArg('先に到達日と届出の要否を確かめてください');
  if (stepOf(proc, 'filing_create').status === 'skipped') throw invalidArg('届出は不要です');
  if (await filingLocked(input.companyId, proc)) throw invalidArg('届出は承認を申請済みです');

  const base = `companies/${input.companyId}`;
  const empPath = `${base}/employees/${proc.employeeId}`;
  const ctx = await contextOf(input.companyId, proc);
  // 画面の値は使わず、保存済みの内容と台帳からサーバーで作る
  const formData = formDataOf(proc, ctx.employee, ctx.office, ctx.grade);
  const filingType = FILING_TYPE[ae.kind];
  const now = Timestamp.now();
  const filings = db.collection(`${empPath}/filings`);
  const existing = ae.filingId ? await filings.doc(ae.filingId).get() : null;
  const filingRef = existing?.exists ? existing.ref : filings.doc();
  let filingVersion = 1;
  if (existing?.exists) {
    filingVersion = (existing.data()!.version as number) + 1;
    await filingRef.update({ formData, workflowStatus: 'draft', effectiveDate: ae.lossDate, version: filingVersion, updatedAt: now });
  } else {
    await filingRef.set({
      filingType, workflowStatus: 'draft', mockStatus: 'notStarted', submissionStatus: 'notSubmitted',
      effectiveDate: ae.lossDate, formData, submittedAt: null, resultReceivedAt: null, resultNote: null, version: 1, createdAt: now, updatedAt: now,
    } satisfies FilingDoc);
  }
  await db.collection(`${base}/auditLogs`).doc().set({
    entity: 'filing', entityId: filingRef.id, action: existing?.exists ? 'update' : 'create',
    changes: { source: { from: null, to: `ageEvent:${ae.kind}` } }, performedBy: auth.uid, performedAt: now, version: filingVersion,
  });
  const filingId = filingRef.id;

  await db.runTransaction(async tx => {
    const latest = (await tx.get(ref)).data() as AgeProc;
    requireVersion(latest, input.expectedVersion);
    let steps = setStep(latest.steps, 'filing_create', {
      ...completed(auth.uid), label: `${FILING_LABEL[ae.kind]}を作る`, referenceType: 'filing', referenceId: filingId, statusDetail: '作成済み',
    });
    steps = setStep(steps, 'approval', { status: 'blocked', referenceType: null, referenceId: null, referenceStatus: null, completedAt: null, completedBy: null });
    for (const id of ['mock_filing', 'paper_submit']) steps = setStep(steps, id, { referenceType: 'filing', referenceId: filingId });
    const references = [
      ...latest.references.filter(r => r.type !== 'filing' && r.type !== 'approval'),
      { type: 'filing' as const, documentId: filingId, employeeId: proc.employeeId, documentSubtype: filingType, stepId: 'filing_create', createdAt: now },
    ];
    tx.update(ref, { 'ageEvent.filingId': filingId, steps, references, version: latest.version + 1, updatedAt: now });
  });

  const { id: requestId } = await createApprovalRequest({
    companyId: input.companyId,
    employeeId: proc.employeeId!,
    targetPath: `${empPath}/filings/${filingId}`,
    targetVersion: filingVersion,
    requestType: 'filing',
    comment: `${proc.employeeName}さんの${FILING_LABEL[ae.kind]}（資格喪失日 ${ae.lossDate}）`,
    metadata: { source: 'ageEvent', procedureId: input.procedureId },
  }, auth);
  await refreshProcedure(input.companyId, input.procedureId);
  return { success: true, filingId, requestId };
}

// ── 完了 ────────────────────────────────────────────

export async function completeAgeEvent(input: { companyId: string; procedureId: string; expectedVersion: number }, auth: AuthContext) {
  const { ref, proc } = await loadProcedure(input.companyId, input.procedureId, auth);
  requireVersion(proc, input.expectedVersion);
  if (stepOf(proc, 'confirm').status !== 'available') throw invalidArg('届出の提出が済んでから完了にしてください');
  if (stepOf(proc, 'filing_create').status !== 'skipped') {
    return confirmProcedure({ procedureId: input.procedureId, stepId: 'confirm', expectedVersion: proc.version }, auth);
  }
  // 届出が要らない70歳到達は、手続き側で閉じる
  const now = Timestamp.now();
  const steps = setStep(proc.steps, 'confirm', completed(auth.uid));
  await db.runTransaction(async tx => {
    const latest = (await tx.get(ref)).data() as AgeProc;
    requireVersion(latest, input.expectedVersion);
    tx.update(ref, { steps, status: 'completed', statusReason: '標準報酬月額相当額が同じため届出なしで完了', completedAt: now, updatedAt: now, version: latest.version + 1 });
  });
  return { success: true };
}

