import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../config';
import { AuthContext, requireOffice } from '../middleware/auth';
import {
  DependentChangeItem, DependentChangeState, DependentDoc, EmployeeDoc, EmploymentDoc, FilingDoc, OfficeDoc, ProcedureDoc,
} from '../types/firestore';
import { invalidArg, notFound } from '../utils/errors';
import { toDateString, toTimestamp } from '../utils/firestore';
import { normalizeEmployment, qualificationDates } from '../utils/employment';
import { buildDependentWizardSteps } from '../procedures/templates';
import { requireProcedureAccess } from '../procedures/access';
import { refreshProcedure } from '../procedures/refresh';
import { completed, latestApprovalId, requireVersion, setStep, statusReasonOf, stepOf } from '../procedures/wizard';
import { createApprovalRequest } from '../approvals/approval-request-create/service';
import { confirmProcedure } from '../procedures/procedure-action/service';
import {
  attachmentHints, ChangeKind, dependentFilingDeadline, judgeDependent, KIND_LABEL, Relationship, RELATIONSHIP_LABEL, RELATIONSHIPS,
} from './rules';
import { ItemInput, PreviewItem } from './schema';

type DependentProcedure = ProcedureDoc & { dependentChange: DependentChangeState };

const nameOf = (e: { lastName: string; firstName: string }) => `${e.lastName} ${e.firstName}`;

/** 旧データの続柄（日本語のこともある）を選択肢に寄せる */
export function toRelationship(value: string): Relationship {
  if ((RELATIONSHIPS as readonly string[]).includes(value)) return value as Relationship;
  if (/配偶者|妻|夫/.test(value)) return 'spouse';
  if (/孫/.test(value)) return 'grandchild';
  if (/祖/.test(value)) return 'grandparent';
  if (/父|母/.test(value)) return 'parent';
  if (/子|男|女|息|娘/.test(value)) return 'child';
  if (/兄|弟|姉|妹/.test(value)) return 'sibling';
  return 'other';
}

function dependentView(id: string, d: DependentDoc) {
  return {
    id, lastName: d.lastName, firstName: d.firstName, lastNameKana: d.lastNameKana, firstNameKana: d.firstNameKana,
    birthDate: d.birthDate ? toDateString(d.birthDate) : '', gender: d.gender, relationship: toRelationship(d.relationship ?? ''),
    income: d.income ?? 0, coResident: d.coResident ?? true, occupation: d.occupation ?? '', isDisabled: d.isDisabled ?? false,
    qualificationDate: d.qualificationDate ? toDateString(d.qualificationDate) : null,
  };
}

// ── 開始 ────────────────────────────────────────────

export async function startDependentChange(input: { employeeId: string; sourceProcedureId: string | null; sourceRequestId?: string | null }, auth: AuthContext) {
  const base = `companies/${auth.companyId}`;
  const empPath = `${base}/employees/${input.employeeId}`;
  const [empSnap, employmentSnap] = await Promise.all([
    db.doc(empPath).get(),
    db.collection(`${empPath}/employments`).orderBy('effectiveDate', 'desc').limit(1).get(),
  ]);
  if (!empSnap.exists || empSnap.data()!.deletedAt !== null) throw notFound('従業員');
  const employee = empSnap.data() as EmployeeDoc;
  requireOffice(auth, employee.officeId);
  if (!employee.isActive) throw invalidArg('退職した人の扶養は変更できません');
  const employment = employmentSnap.empty ? null : normalizeEmployment(employmentSnap.docs[0].data() as EmploymentDoc);
  if (employment && !employment.healthInsuranceEnrolled) throw invalidArg('健康保険に加入していないため、扶養に入れることはできません');

  // 同じ人の進行中の扶養の手続きがあれば、それを開く（二重に始めない）
  const existing = await db.collection(`${base}/procedures`).where('employeeId', '==', input.employeeId).where('deletedAt', '==', null).get();
  const open = existing.docs.find(d => {
    const p = d.data() as ProcedureDoc;
    return p.dependentChange && p.status === 'in_progress';
  });
  if (open) {
    const prefilled = input.sourceRequestId ? await addRequestItem(auth.companyId, open.ref, input.employeeId, input.sourceRequestId) : false;
    return { procedureId: open.id, existing: true, prefilled };
  }

  // 入社の手続きから始めたときは、本人が申し出た家族を「扶養に入れる」として引き継ぐ
  let items: DependentChangeItem[] = [];
  if (input.sourceProcedureId) {
    const src = (await db.doc(`${base}/procedures/${input.sourceProcedureId}`).get()).data() as ProcedureDoc | undefined;
    if (src?.onboarding && src.employeeId === input.employeeId) {
      items = (src.onboarding.selfInput?.dependents ?? []).map(d => ({
        kind: 'add' as const, dependentId: null, eventDate: src.onboarding!.hireDate,
        lastName: d.lastName, firstName: d.firstName, lastNameKana: '', firstNameKana: '',
        birthDate: d.birthDate ?? '', gender: 'female' as const, relationship: toRelationship(d.relationship),
        income: 0, coResident: true, occupation: '', isDisabled: false, reason: '', exceptionReason: '',
      }));
    }
  }

  // 本人からの申請から始めたときは、申請の中身を項目として入れておく（担当者がウィザードで確かめて直す）
  if (input.sourceRequestId) {
    const { dependentItemFromRequest, loadRequestForHandoff } = await import('../portal/handoff');
    const req = await loadRequestForHandoff(auth.companyId, input.sourceRequestId, input.employeeId, ['dependentAdd', 'dependentRemove']);
    const item = dependentItemFromRequest(req.type, req.detail, await currentDependents(auth.companyId, input.employeeId));
    if (item) items = [...items, item];
  }
  const prefilled = !!input.sourceRequestId && items.length > 0;

  const name = nameOf(employee);
  const now = Timestamp.now();
  const ref = db.collection(`${base}/procedures`).doc();
  const steps = buildDependentWizardSteps();
  const batch = db.batch();
  batch.set(ref, {
    procedureType: 'dependent_change', title: `${name} 扶養の手続き`, priority: 'normal', status: 'in_progress', statusReason: statusReasonOf(steps),
    employeeId: input.employeeId, employeeName: name, officeId: employee.officeId, targetOfficeId: null, scope: 'individual',
    batchMeta: null, invitationId: null, onboardToken: null, steps, deadline: null, effectiveDate: null,
    assignedTo: auth.uid, createdBy: auth.uid, references: [], notes: '', version: 1,
    createdAt: now, updatedAt: now, completedAt: null, deletedAt: null,
    dependentChange: { items, sourceProcedureId: input.sourceProcedureId, filingId: null, appliedAt: null },
  } satisfies ProcedureDoc);
  batch.set(db.collection(`${base}/auditLogs`).doc(), {
    entity: 'procedure', entityId: ref.id, action: 'create', changes: { procedureType: { from: null, to: 'dependent_change' } },
    performedBy: auth.uid, performedAt: now, version: 1,
  });
  await batch.commit();
  return { procedureId: ref.id, existing: false, prefilled };
}

// ── 読み取り ────────────────────────────────────────

async function loadProcedure(companyId: string, procedureId: string, auth: AuthContext) {
  const ref = db.doc(`companies/${companyId}/procedures/${procedureId}`);
  const snap = await ref.get();
  if (!snap.exists) throw notFound('手続き');
  const proc = snap.data() as ProcedureDoc;
  requireProcedureAccess(auth, proc);
  if (!proc.dependentChange || !proc.employeeId) throw invalidArg('この手続きは扶養の画面では扱えません');
  return { ref, proc: proc as DependentProcedure };
}

export type DependentStepKey = 'change' | 'filing' | 'approval' | 'submit' | 'confirm' | 'done';

export function currentDependentStep(proc: ProcedureDoc): DependentStepKey {
  if (proc.status === 'completed') return 'done';
  const s = (id: string) => stepOf(proc, id);
  if (s('change').status !== 'completed') return 'change';
  if (s('filing_create').status !== 'completed') return 'filing';
  if (s('approval').status !== 'completed') return 'approval';
  if (s('mock_filing').status !== 'completed' && s('paper_submit').status !== 'completed') return 'submit';
  return 'confirm';
}

/** 今扶養に入っている人（外していない人） */
async function currentDependents(companyId: string, employeeId: string) {
  const snap = await db.collection(`companies/${companyId}/employees/${employeeId}/dependents`).where('deletedAt', '==', null).get();
  return snap.docs.filter(d => !(d.data() as DependentDoc).disqualificationDate).map(d => dependentView(d.id, d.data() as DependentDoc));
}

/**
 * 進行中の扶養の手続きに、本人からの申請の項目を足す。変わった内容をまだ保存していないときだけ足す
 * （保存後・届出の作成後は、担当者がウィザードで手で入れる）。同じ人がもう入っていれば足さずに済ませる
 */
async function addRequestItem(companyId: string, ref: FirebaseFirestore.DocumentReference, employeeId: string, requestId: string) {
  const { dependentItemFromRequest, loadRequestForHandoff } = await import('../portal/handoff');
  const req = await loadRequestForHandoff(companyId, requestId, employeeId, ['dependentAdd', 'dependentRemove']);
  const item = dependentItemFromRequest(req.type, req.detail, await currentDependents(companyId, employeeId));
  if (!item) return false;
  return db.runTransaction(async tx => {
    const latest = (await tx.get(ref)).data() as DependentProcedure;
    if (stepOf(latest, 'change').status === 'completed' || latest.dependentChange.filingId) return false;
    const items = latest.dependentChange.items;
    if (items.some(x => x.kind === item.kind && x.lastName === item.lastName && x.firstName === item.firstName)) return true;
    tx.update(ref, { 'dependentChange.items': [...items, item], version: latest.version + 1, updatedAt: Timestamp.now() });
    return true;
  });
}

function judge(items: PreviewItem[]) {
  return items.map(i => i.kind === 'add' && i.birthDate && i.eventDate
    ? judgeDependent({
      relationship: toRelationship(i.relationship), birthDate: i.birthDate, isDisabled: i.isDisabled,
      income: i.income, coResident: i.coResident, eventDate: i.eventDate,
    })
    : null);
}

function summaryOf(items: PreviewItem[]) {
  return {
    judgements: judge(items),
    deadline: dependentFilingDeadline(items.map(i => i.eventDate).filter(Boolean)),
    attachments: attachmentHints(items.map(i => ({ kind: i.kind, relationship: toRelationship(i.relationship), coResident: i.coResident, reason: i.reason }))),
  };
}

async function filingLocked(companyId: string, proc: DependentProcedure) {
  const empPath = `companies/${companyId}/employees/${proc.employeeId}`;
  if (proc.dependentChange.filingId) {
    const f = await db.doc(`${empPath}/filings/${proc.dependentChange.filingId}`).get();
    if (f.exists && f.data()!.workflowStatus === 'approved') return true;
  }
  const approvalId = latestApprovalId(proc);
  if (!approvalId) return false;
  const a = await db.doc(`${empPath}/approvalRequests/${approvalId}`).get();
  return a.exists && a.data()!.status === 'pending';
}

export async function getDependentChange(companyId: string, procedureId: string, auth: AuthContext) {
  let { proc } = await loadProcedure(companyId, procedureId, auth);
  if (proc.status === 'in_progress' && proc.dependentChange.filingId) {
    proc = (await refreshProcedure(companyId, procedureId)).procedure as DependentProcedure;
  }
  const dc = proc.dependentChange;
  const base = `companies/${companyId}`;
  const empPath = `${base}/employees/${proc.employeeId}`;
  const approvalId = latestApprovalId(proc);
  const [empSnap, office, filingSnap, approvalSnap, dependents] = await Promise.all([
    db.doc(empPath).get(),
    db.doc(`${base}/offices/${proc.officeId}`).get(),
    dc.filingId ? db.doc(`${empPath}/filings/${dc.filingId}`).get() : null,
    approvalId ? db.doc(`${empPath}/approvalRequests/${approvalId}`).get() : null,
    currentDependents(companyId, proc.employeeId!),
  ]);
  const e = empSnap.data() as EmployeeDoc;
  const filing = filingSnap?.exists ? filingSnap.data() as FilingDoc : null;
  return {
    procedure: {
      id: procedureId, version: proc.version, status: proc.status, title: proc.title,
      officeId: proc.officeId, officeName: (office.data()?.name as string) ?? '', employeeName: proc.employeeName,
      fromOnboarding: dc.sourceProcedureId !== null,
    },
    current: currentDependentStep(proc),
    steps: proc.steps.map(s => ({ id: s.id, label: s.label, status: s.status, statusDetail: s.statusDetail })),
    employee: {
      id: proc.employeeId!, employeeNumber: e.employeeNumber, name: nameOf(e),
      acquisitionDate: qualificationDates({ ...e, resignationDate: null } as EmployeeDoc).acquisitionDate,
    },
    items: dc.items,
    ...summaryOf(dc.items),
    dependents,
    filing: filing && dc.filingId ? {
      id: dc.filingId, version: filing.version, workflowStatus: filing.workflowStatus,
      mockStatus: filing.mockStatus, submissionStatus: filing.submissionStatus, resultNote: filing.resultNote,
    } : null,
    approval: approvalSnap?.exists ? { status: approvalSnap.data()!.status as string, comment: (approvalSnap.data()!.comment ?? null) as string | null } : null,
    locked: await filingLocked(companyId, proc),
    appliedAt: dc.appliedAt?.toDate().toISOString() ?? null,
  };
}

// ── 変わった内容 ───────────────────────────────────────

export async function previewItems(input: { companyId: string; procedureId: string; items: PreviewItem[] }, auth: AuthContext) {
  await loadProcedure(input.companyId, input.procedureId, auth);
  return summaryOf(input.items);
}

/** 保存の前の確認。画面の判定は信用せず、サーバーで判定し直す */
function validateItems(items: ItemInput[], dependents: { id: string }[], acquisitionDate: string | null) {
  const ids = new Set(dependents.map(d => d.id));
  const used = new Set<string>();
  const judgements = judge(items);
  items.forEach((item, i) => {
    const who = `${i + 1}人目（${item.lastName} ${item.firstName}）`;
    if (item.kind !== 'add') {
      if (!item.dependentId || !ids.has(item.dependentId)) throw invalidArg(`${who}：扶養に入っている人から選んでください`);
      if (used.has(item.dependentId)) throw invalidArg(`${who}：同じ人が2回入っています`);
      used.add(item.dependentId);
      if (!item.reason) throw invalidArg(`${who}：${item.kind === 'remove' ? '外す理由' : '変わった内容'}を入れてください`);
    }
    if (item.kind === 'add') {
      if (item.eventDate < item.birthDate) throw invalidArg(`${who}：扶養に入れる日が生年月日より前です`);
      if (acquisitionDate && item.eventDate < acquisitionDate) throw invalidArg(`${who}：扶養に入れる日が、本人の資格取得日（${acquisitionDate}）より前です`);
      const j = judgements[i]!;
      if (j.lateElderly) throw invalidArg(`${who}：75歳以上のため扶養に入れません（後期高齢者医療制度）`);
      if (j.overLimit && !item.exceptionReason) throw invalidArg(`${who}：年間収入が${j.basis}以上です。扶養に入れる場合は理由を入れてください`);
    }
  });
}

export async function saveChange(input: { companyId: string; procedureId: string; expectedVersion: number; items: ItemInput[] }, auth: AuthContext) {
  const { ref, proc } = await loadProcedure(input.companyId, input.procedureId, auth);
  requireVersion(proc, input.expectedVersion);
  if (await filingLocked(input.companyId, proc)) throw invalidArg('届出の承認を申請済みです。直す場合は承認者に差し戻してもらってください');
  const empSnap = await db.doc(`companies/${input.companyId}/employees/${proc.employeeId}`).get();
  const acquisitionDate = qualificationDates({ ...(empSnap.data() as EmployeeDoc), resignationDate: null } as EmployeeDoc).acquisitionDate;
  validateItems(input.items, await currentDependents(input.companyId, proc.employeeId!), acquisitionDate);
  const deadline = dependentFilingDeadline(input.items.map(i => i.eventDate));

  await db.runTransaction(async tx => {
    const latest = (await tx.get(ref)).data() as DependentProcedure;
    requireVersion(latest, input.expectedVersion);
    const now = Timestamp.now();
    const counts = (['add', 'remove', 'change'] as ChangeKind[]).map(k => [k, input.items.filter(i => i.kind === k).length] as const).filter(([, n]) => n > 0);
    let steps = setStep(latest.steps, 'change', { ...completed(auth.uid), statusDetail: counts.map(([k, n]) => `${KIND_LABEL[k].slice(0, 3)}${n}人`).join('・') });
    // 入れ直したら届出は作り直す
    steps = setStep(steps, 'filing_create', { status: 'available', referenceType: null, referenceId: null, referenceStatus: null, completedAt: null, completedBy: null, statusDetail: null });
    steps = setStep(steps, 'approval', { status: 'blocked', referenceType: null, referenceId: null, referenceStatus: null, completedAt: null, completedBy: null, statusDetail: null });
    steps = setStep(steps, 'confirm', { status: 'blocked', completedAt: null, completedBy: null });
    tx.update(ref, {
      'dependentChange.items': input.items,
      references: latest.references.filter(r => r.type !== 'approval'),
      steps, statusReason: statusReasonOf(steps),
      deadline: deadline ? toTimestamp(deadline) : null,
      effectiveDate: toTimestamp([...input.items.map(i => i.eventDate)].sort()[0]),
      version: latest.version + 1, updatedAt: now,
    });
  });
  return { success: true };
}

// ── 被扶養者（異動）届と承認 ─────────────────────────────

export async function submitDependentFiling(input: { companyId: string; procedureId: string; expectedVersion: number }, auth: AuthContext) {
  const { ref, proc } = await loadProcedure(input.companyId, input.procedureId, auth);
  requireVersion(proc, input.expectedVersion);
  const dc = proc.dependentChange;
  if (stepOf(proc, 'change').status !== 'completed' || !dc.items.length) throw invalidArg('先に変わった内容を入れてください');
  if (await filingLocked(input.companyId, proc)) throw invalidArg('届出は承認を申請済みです');

  const base = `companies/${input.companyId}`;
  const empPath = `${base}/employees/${proc.employeeId}`;
  const [empSnap, officeSnap] = await Promise.all([db.doc(empPath).get(), db.doc(`${base}/offices/${proc.officeId}`).get()]);
  const e = empSnap.data() as EmployeeDoc;
  const office = (officeSnap.data() ?? {}) as OfficeDoc;
  const judgements = judge(dc.items);
  const gender = (g: string) => g === 'male' ? '男' : '女';

  // 画面の値は使わず、保存済みの内容からサーバーで作る。被扶養者一覧の形は届出のPDFと同じ
  const formData = {
    '事業所整理記号': office.officeNumber ?? '',
    '事業所名称': office.name ?? '',
    '被保険者整理番号': e.insuredPersonNumber ?? '',
    '被保険者氏名': nameOf(e),
    '被保険者氏名フリガナ': `${e.lastNameKana} ${e.firstNameKana}`,
    '生年月日': e.birthDate ? toDateString(e.birthDate) : '',
    '性別': gender(e.gender),
    '個人番号': '',
    '基礎年金番号': '',
    '届出区分': '被扶養者（異動）届',
    '届出年月日': [...dc.items.map(i => i.eventDate)].sort()[0],
    '被扶養者一覧': dc.items.map((i, n) => ({
      '異動の種別': i.kind === 'add' ? '該当' : i.kind === 'remove' ? '非該当' : '変更',
      '異動年月日': i.eventDate,
      '氏名': `${i.lastName} ${i.firstName}`,
      'フリガナ': `${i.lastNameKana} ${i.firstNameKana}`,
      '生年月日': i.birthDate,
      '性別': gender(i.gender),
      '続柄': RELATIONSHIP_LABEL[toRelationship(i.relationship)],
      '同居別居': i.coResident ? '同居' : '別居',
      '年間収入': i.income,
      '職業': i.occupation,
      '障害': i.isDisabled ? 'あり' : 'なし',
      '理由': i.reason,
      '第3号被保険者': judgements[n]?.thirdInsured ? '該当' : '',
    })),
    '備考': dc.items.filter(i => i.exceptionReason).map(i => `${i.lastName} ${i.firstName}：${i.exceptionReason}`).join('／'),
  };

  const now = Timestamp.now();
  const filings = db.collection(`${empPath}/filings`);
  const existing = dc.filingId ? await filings.doc(dc.filingId).get() : null;
  const filingRef = existing?.exists ? existing.ref : filings.doc();
  let filingVersion = 1;
  const effectiveDate = formData['届出年月日'];
  if (existing?.exists) {
    filingVersion = (existing.data()!.version as number) + 1;
    await filingRef.update({ formData, workflowStatus: 'draft', effectiveDate, version: filingVersion, updatedAt: now });
  } else {
    await filingRef.set({
      filingType: 'dependentChange', workflowStatus: 'draft', mockStatus: 'notStarted', submissionStatus: 'notSubmitted',
      effectiveDate, formData, submittedAt: null, resultReceivedAt: null, resultNote: null, version: 1, createdAt: now, updatedAt: now,
    } satisfies FilingDoc);
  }
  await db.collection(`${base}/auditLogs`).doc().set({
    entity: 'filing', entityId: filingRef.id, action: existing?.exists ? 'update' : 'create',
    changes: { source: { from: null, to: 'dependentChange' } }, performedBy: auth.uid, performedAt: now, version: filingVersion,
  });

  const filingId = filingRef.id;
  await db.runTransaction(async tx => {
    const latest = (await tx.get(ref)).data() as DependentProcedure;
    requireVersion(latest, input.expectedVersion);
    let steps = setStep(latest.steps, 'filing_create', { ...completed(auth.uid), referenceType: 'filing', referenceId: filingId, statusDetail: '作成済み' });
    steps = setStep(steps, 'approval', { status: 'blocked', referenceType: null, referenceId: null, referenceStatus: null, completedAt: null, completedBy: null });
    for (const id of ['mock_filing', 'paper_submit']) steps = setStep(steps, id, { referenceType: 'filing', referenceId: filingId });
    const references = [
      ...latest.references.filter(r => r.type !== 'filing' && r.type !== 'approval'),
      { type: 'filing' as const, documentId: filingId, employeeId: proc.employeeId, documentSubtype: 'dependentChange', stepId: 'filing_create', createdAt: now },
    ];
    tx.update(ref, { 'dependentChange.filingId': filingId, steps, references, version: latest.version + 1, updatedAt: now });
  });

  const names = dc.items.map(i => `${i.lastName} ${i.firstName}（${i.kind === 'add' ? '該当' : i.kind === 'remove' ? '非該当' : '変更'}）`).join('・');
  const { id: requestId } = await createApprovalRequest({
    companyId: input.companyId,
    employeeId: proc.employeeId!,
    targetPath: `${empPath}/filings/${filingId}`,
    targetVersion: filingVersion,
    requestType: 'filing',
    comment: `${proc.employeeName}さんの被扶養者（異動）届：${names}`,
    metadata: { source: 'dependentChange', procedureId: input.procedureId },
  }, auth);
  await refreshProcedure(input.companyId, input.procedureId);
  return { success: true, filingId, requestId };
}

// ── 完了（台帳への反映） ─────────────────────────────────

/**
 * 届出の提出が済んだら、台帳の被扶養者に反映して完了にする。
 * 追加は被扶養者を作り、外す人は外した日と理由を記録し、変更は内容を書き換える（何度呼んでも二重に反映しない）
 */
export async function completeDependentChange(input: { companyId: string; procedureId: string; expectedVersion: number }, auth: AuthContext) {
  const { ref, proc } = await loadProcedure(input.companyId, input.procedureId, auth);
  requireVersion(proc, input.expectedVersion);
  if (stepOf(proc, 'confirm').status !== 'available') throw invalidArg('届出の提出が済んでから完了にしてください');
  const depBase = `companies/${input.companyId}/employees/${proc.employeeId}/dependents`;
  let version = proc.version;

  if (!proc.dependentChange.appliedAt) {
    await db.runTransaction(async tx => {
      const latest = (await tx.get(ref)).data() as DependentProcedure;
      requireVersion(latest, input.expectedVersion);
      if (latest.dependentChange.appliedAt) return;
      const items = latest.dependentChange.items;
      const existing = await Promise.all(items.map(i => i.dependentId ? tx.get(db.doc(`${depBase}/${i.dependentId}`)) : Promise.resolve(null)));
      const now = Timestamp.now();
      const applied = items.map((item, n) => {
        const fields = {
          lastName: item.lastName, firstName: item.firstName, lastNameKana: item.lastNameKana, firstNameKana: item.firstNameKana,
          birthDate: toTimestamp(item.birthDate), gender: item.gender, relationship: toRelationship(item.relationship),
          isDisabled: item.isDisabled, income: item.income, coResident: item.coResident, occupation: item.occupation || null,
        };
        if (item.kind === 'add') {
          const depRef = db.collection(depBase).doc();
          tx.set(depRef, {
            ...fields, qualificationDate: toTimestamp(item.eventDate), disqualificationDate: null, disqualificationReason: null,
            certification: 'certified', deletedAt: null, createdAt: now, updatedAt: now,
          } satisfies DependentDoc);
          return { ...item, dependentId: depRef.id };
        }
        const snap = existing[n];
        if (!snap?.exists) throw invalidArg(`${item.lastName} ${item.firstName}さんが台帳に見つかりません`);
        tx.update(snap.ref, item.kind === 'remove'
          ? { disqualificationDate: toTimestamp(item.eventDate), disqualificationReason: item.reason, certification: 'removed', updatedAt: now }
          : { ...fields, updatedAt: now });
        return item;
      });
      tx.update(ref, { 'dependentChange.items': applied, 'dependentChange.appliedAt': now, version: latest.version + 1, updatedAt: now });
      tx.set(db.collection(`companies/${input.companyId}/auditLogs`).doc(), {
        entity: 'dependent', entityId: proc.employeeId, action: 'update',
        changes: Object.fromEntries(applied.map(i => [i.dependentId!, { from: null, to: i.kind }])),
        note: `扶養の手続き ${input.procedureId}`, performedBy: auth.uid, performedAt: now, version: 1,
      });
    });
    version += 1;
  }
  return confirmProcedure({ procedureId: input.procedureId, stepId: 'confirm', expectedVersion: version }, auth);
}
