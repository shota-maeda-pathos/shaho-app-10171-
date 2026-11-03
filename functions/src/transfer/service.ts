import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../config';
import { AuthContext, requireOffice } from '../middleware/auth';
import { EmployeeDoc, FilingDoc, GradeDoc, OfficeDoc, ProcedureDoc, TransferState } from '../types/firestore';
import { invalidArg, notFound } from '../utils/errors';
import { toDateString } from '../utils/firestore';
import { addDays, fiveDayDeadline } from '../insurance/calculator';
import { buildTransferWizardSteps } from '../procedures/templates';
import { requireProcedureAccess } from '../procedures/access';
import { completed, requireVersion, setStep, statusReasonOf, stepOf } from '../procedures/wizard';
import { createApprovalRequest } from '../approvals/approval-request-create/service';
import { OfficeFacts, transferFacts } from './rules';
import { assertAssignable } from '../offices/lifecycle';
import { acquisitionLedgerFields, acquisitionRemarkItems } from '../filings/acquisition-fields';

type TransferProc = ProcedureDoc & { transfer: TransferState };
const nameOf = (e: { lastName: string; firstName: string }) => `${e.lastName} ${e.firstName}`;

async function officeFacts(companyId: string, officeId: string): Promise<OfficeFacts & { raw: OfficeDoc }> {
  const snap = await db.doc(`companies/${companyId}/offices/${officeId}`).get();
  if (!snap.exists) throw notFound('事業所');
  const o = snap.data() as OfficeDoc;
  return {
    id: officeId, name: o.name ?? '', officeNumber: o.officeNumber ?? '', prefectureCode: o.prefectureCode ?? '', insurerId: o.insurerId ?? '',
    pensionOfficeName: o.pensionOfficeName ?? null, raw: o,
  };
}

// ── 開始 ────────────────────────────────────────────

export async function startTransfer(input: { employeeId: string }, auth: AuthContext) {
  const base = `companies/${auth.companyId}`;
  const empSnap = await db.doc(`${base}/employees/${input.employeeId}`).get();
  if (!empSnap.exists || empSnap.data()!.deletedAt !== null) throw notFound('従業員');
  const employee = empSnap.data() as EmployeeDoc;
  requireOffice(auth, employee.officeId);
  if (!employee.isActive) throw invalidArg('退職した人は異動できません');
  const existing = await db.collection(`${base}/procedures`).where('employeeId', '==', input.employeeId).where('deletedAt', '==', null).get();
  const open = existing.docs.find(d => !!(d.data() as ProcedureDoc).transfer && d.data().status === 'in_progress');
  if (open) return { procedureId: open.id, existing: true };

  const name = nameOf(employee);
  const now = Timestamp.now();
  const ref = db.collection(`${base}/procedures`).doc();
  const steps = buildTransferWizardSteps();
  const batch = db.batch();
  batch.set(ref, {
    procedureType: 'transfer', title: `${name} 事業所間異動`, priority: 'normal', status: 'in_progress', statusReason: statusReasonOf(steps),
    employeeId: input.employeeId, employeeName: name, officeId: employee.officeId, targetOfficeId: null, scope: 'individual',
    batchMeta: null, invitationId: null, onboardToken: null, steps, deadline: null, effectiveDate: null,
    assignedTo: auth.uid, createdBy: auth.uid, references: [], notes: '', version: 1,
    createdAt: now, updatedAt: now, completedAt: null, deletedAt: null,
    transfer: { fromOfficeId: employee.officeId, toOfficeId: null, transferDate: null, reason: '', filingRequired: false, applied: false, lossFilingId: null, acquisitionFilingId: null },
  } satisfies ProcedureDoc);
  batch.set(db.collection(`${base}/auditLogs`).doc(), {
    entity: 'procedure', entityId: ref.id, action: 'create', changes: { procedureType: { from: null, to: 'transfer' } }, performedBy: auth.uid, performedAt: now, version: 1,
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
  if (!proc.transfer || !proc.employeeId) throw invalidArg('この手続きは異動の画面では扱えません');
  return { ref, proc: proc as TransferProc };
}

export type TransferStepKey = 'entry' | 'apply' | 'filings' | 'confirm' | 'done';

export function currentTransferStep(proc: ProcedureDoc): TransferStepKey {
  if (proc.status === 'completed') return 'done';
  const s = (id: string) => stepOf(proc, id);
  if (s('entry').status !== 'completed') return 'entry';
  if (s('apply').status !== 'completed') return 'apply';
  if (s('filings').status !== 'completed' && s('filings').status !== 'skipped') return 'filings';
  return 'confirm';
}

const filingDone = (f: FilingDoc | null) => !!f && (f.mockStatus === 'completed' || f.submissionStatus === 'accepted');

export async function previewTransfer(input: { companyId: string; procedureId: string; toOfficeId: string; transferDate: string }, auth: AuthContext) {
  const { proc } = await loadProcedure(input.companyId, input.procedureId, auth);
  if (input.toOfficeId === proc.transfer.fromOfficeId) throw invalidArg('異動先は今の事業所と違う事業所を選んでください');
  const [from, to] = await Promise.all([officeFacts(input.companyId, proc.transfer.fromOfficeId), officeFacts(input.companyId, input.toOfficeId)]);
  return transferFacts(from, to, input.transferDate);
}

export async function getTransfer(companyId: string, procedureId: string, auth: AuthContext) {
  const { ref, proc: loaded } = await loadProcedure(companyId, procedureId, auth);
  let proc = loaded;
  const t = proc.transfer;
  const base = `companies/${companyId}`;
  const empPath = `${base}/employees/${proc.employeeId}`;
  const [empSnap, from, to, lossSnap, acqSnap] = await Promise.all([
    db.doc(empPath).get(),
    officeFacts(companyId, t.fromOfficeId),
    t.toOfficeId ? officeFacts(companyId, t.toOfficeId) : null,
    t.lossFilingId ? db.doc(`${empPath}/filings/${t.lossFilingId}`).get() : null,
    t.acquisitionFilingId ? db.doc(`${empPath}/filings/${t.acquisitionFilingId}`).get() : null,
  ]);
  const loss = lossSnap?.exists ? lossSnap.data() as FilingDoc : null;
  const acq = acqSnap?.exists ? acqSnap.data() as FilingDoc : null;
  // 2件の届出の提出が済んだら、届出のステップを終える
  if (proc.status === 'in_progress' && stepOf(proc, 'filings').status !== 'completed' && filingDone(loss) && filingDone(acq)) {
    await db.runTransaction(async tx => {
      const latest = (await tx.get(ref)).data() as TransferProc;
      let steps = setStep(latest.steps, 'filings', { ...completed(auth.uid), statusDetail: '2件とも提出済み' });
      steps = setStep(steps, 'confirm', { status: 'available' });
      tx.update(ref, { steps, statusReason: statusReasonOf(steps), version: latest.version + 1, updatedAt: Timestamp.now() });
    });
    proc = (await ref.get()).data() as TransferProc;
  }
  const e = empSnap.data() as EmployeeDoc;
  const filing = (id: string | null, f: FilingDoc | null) => id && f ? {
    id, workflowStatus: f.workflowStatus, mockStatus: f.mockStatus, submissionStatus: f.submissionStatus, done: filingDone(f),
  } : null;
  return {
    procedure: { id: procedureId, version: proc.version, status: proc.status, title: proc.title, officeName: from.name, employeeName: proc.employeeName },
    current: currentTransferStep(proc),
    steps: proc.steps.map(s => ({ id: s.id, label: s.label, status: s.status, statusDetail: s.statusDetail })),
    employee: { id: proc.employeeId!, employeeNumber: e.employeeNumber, name: nameOf(e), currentOfficeId: e.officeId, otherEmployer: e.otherEmployer?.name ?? null },
    from: { id: from.id, name: from.name },
    to: to ? { id: to.id, name: to.name } : null,
    transferDate: proc.transfer.transferDate,
    reason: proc.transfer.reason,
    facts: to && proc.transfer.transferDate ? transferFacts(from, to, proc.transfer.transferDate) : null,
    applied: proc.transfer.applied,
    lossFiling: filing(proc.transfer.lossFilingId, loss),
    acquisitionFiling: filing(proc.transfer.acquisitionFilingId, acq),
  };
}

// ── 異動先と異動日 ─────────────────────────────────────

export async function saveTransferEntry(input: { companyId: string; procedureId: string; expectedVersion: number; toOfficeId: string; transferDate: string; reason: string }, auth: AuthContext) {
  const { ref, proc } = await loadProcedure(input.companyId, input.procedureId, auth);
  requireVersion(proc, input.expectedVersion);
  if (proc.transfer.applied) throw invalidArg('台帳の所属事業所を変えたあとは、異動先・異動日は直せません');
  requireOffice(auth, input.toOfficeId);
  // 設定が終わっていない事業所・廃止した事業所には異動できない（カタログ1章 事業所ライフサイクル）
  await assertAssignable(input.companyId, input.toOfficeId);
  const facts = await previewTransfer(input, auth);
  await db.runTransaction(async tx => {
    const latest = (await tx.get(ref)).data() as TransferProc;
    requireVersion(latest, input.expectedVersion);
    let steps = setStep(latest.steps, 'entry', { ...completed(auth.uid), statusDetail: `${input.transferDate}に異動${facts.filingRequired ? '（届出あり）' : '（届出なし）'}` });
    steps = setStep(steps, 'apply', { status: 'available' });
    tx.update(ref, {
      'transfer.toOfficeId': input.toOfficeId, 'transfer.transferDate': input.transferDate, 'transfer.reason': input.reason,
      'transfer.filingRequired': facts.filingRequired, targetOfficeId: input.toOfficeId,
      effectiveDate: Timestamp.fromDate(new Date(`${input.transferDate}T00:00:00Z`)),
      deadline: facts.filingRequired ? Timestamp.fromDate(new Date(`${fiveDayDeadline(input.transferDate)}T00:00:00Z`)) : null,
      steps, statusReason: statusReasonOf(steps), version: latest.version + 1, updatedAt: Timestamp.now(),
    });
  });
  return { success: true, facts };
}

// ── 台帳の付け替えと届出 ──────────────────────────────────

/** 台帳の所属事業所を変え、別の適用事業所への異動なら資格喪失届（旧）と資格取得届（新）を作って承認を依頼する */
export async function applyTransfer(input: { companyId: string; procedureId: string; expectedVersion: number }, auth: AuthContext) {
  const { ref, proc } = await loadProcedure(input.companyId, input.procedureId, auth);
  requireVersion(proc, input.expectedVersion);
  const t = proc.transfer;
  if (!t.toOfficeId || !t.transferDate) throw invalidArg('先に異動先と異動日を入れてください');
  if (t.applied) throw invalidArg('台帳は変更済みです');
  const base = `companies/${input.companyId}`;
  const empRef = db.doc(`${base}/employees/${proc.employeeId}`);
  const [from, to, gradeSnap] = await Promise.all([
    officeFacts(input.companyId, t.fromOfficeId),
    officeFacts(input.companyId, t.toOfficeId),
    db.collection(`${empRef.path}/grades`).where('effectiveMonth', '<=', t.transferDate.slice(0, 7)).orderBy('effectiveMonth', 'desc').limit(1).get(),
  ]);
  const grade = gradeSnap.empty ? null : gradeSnap.docs[0].data() as GradeDoc;
  if (t.filingRequired && !grade) throw invalidArg('今の等級がないため、資格取得届を作れません。等級を決めてから進めてください');
  const effectiveMonth = t.transferDate.slice(0, 7);
  if (t.filingRequired && grade?.effectiveMonth === effectiveMonth) throw invalidArg(`${effectiveMonth}の等級がすでにあります。異動日の月に新しい等級は作れないため、等級を確かめてください`);

  const now = Timestamp.now();
  const filings = db.collection(`${empRef.path}/filings`);
  const lossRef = t.filingRequired ? filings.doc() : null;
  const acqRef = t.filingRequired ? filings.doc() : null;
  // 資格取得届の住所・被扶養者の有無（台帳の値。異動では変わらない）
  const ledger = t.filingRequired ? await acquisitionLedgerFields(input.companyId, proc.employeeId!, (await empRef.get()).data() as EmployeeDoc) : {};
  let employee!: EmployeeDoc;
  await db.runTransaction(async tx => {
    const latest = (await tx.get(ref)).data() as TransferProc;
    requireVersion(latest, input.expectedVersion);
    const empSnap = await tx.get(empRef);
    employee = empSnap.data() as EmployeeDoc;
    if (employee.officeId !== t.fromOfficeId) throw invalidArg('所属事業所が手続きを始めたときから変わっています。画面を読み込み直してください');
    tx.update(empRef, { officeId: t.toOfficeId, updatedAt: now, version: employee.version + 1 });
    tx.set(db.collection(`${empRef.path}/transferHistory`).doc(), {
      fromOfficeId: t.fromOfficeId, toOfficeId: t.toOfficeId, transferDate: Timestamp.fromDate(new Date(`${t.transferDate}T00:00:00Z`)),
      reason: t.reason || null, procedureId: input.procedureId, performedBy: auth.uid, createdAt: now,
    });
    tx.set(db.collection(`${base}/auditLogs`).doc(), {
      entity: 'employee', entityId: proc.employeeId, action: 'transfer', changes: { officeId: { from: t.fromOfficeId, to: t.toOfficeId } },
      performedBy: auth.uid, performedAt: now, version: employee.version + 1,
    });
    if (lossRef && acqRef && grade) {
      const person = {
        '被保険者整理番号': employee.insuredPersonNumber ?? '', '被保険者氏名': nameOf(employee), '被保険者氏名フリガナ': `${employee.lastNameKana} ${employee.firstNameKana}`,
        '生年月日': employee.birthDate ? toDateString(employee.birthDate) : '', '性別': employee.gender === 'male' ? '男' : '女', '個人番号': '', '基礎年金番号': employee.basicPensionNumber ?? '',
      };
      const remuneration = grade.basisRemuneration ?? grade.healthStandardRemuneration;
      const draft = (filingType: string, officeId: string, formData: Record<string, unknown>) => ({
        filingType, officeId, workflowStatus: 'draft' as const, mockStatus: 'notStarted' as const, submissionStatus: 'notSubmitted' as const,
        effectiveDate: t.transferDate!, formData, submittedAt: null, resultReceivedAt: null, resultNote: null, version: 1, createdAt: now, updatedAt: now,
      } satisfies FilingDoc);
      tx.set(lossRef, draft('lossNotification', t.fromOfficeId, {
        '事業所整理記号': from.officeNumber, '事業所名称': from.name, ...person, '届出区分': '資格喪失届',
        '資格喪失年月日': t.transferDate, '喪失原因': '退職等', '退職年月日': addDays(t.transferDate!, -1), '喪失する保険': '健保・厚年',
        '最終標準報酬月額_健康保険': grade.healthStandardRemuneration, '最終標準報酬月額_厚生年金': grade.pensionStandardRemuneration,
        '保険証回収_添付': 0, '保険証回収_返不能': 0, '備考': `転勤（${to.name}へ）`,
      }));
      tx.set(acqRef, draft('acquisitionNotification', t.toOfficeId!, {
        '事業所整理記号': to.officeNumber, '事業所名称': to.name, ...person, '届出区分': '資格取得届',
        '資格取得年月日': t.transferDate, '取得区分': '健保・厚年', '被保険者種別': '一般',
        '報酬月額_通貨': remuneration, '報酬月額_現物': 0, '報酬月額_合計': remuneration,
        '健康保険_等級': grade.healthGradeNumber, '健康保険_標準報酬月額': grade.healthStandardRemuneration,
        '厚生年金_等級': grade.pensionGradeNumber, '厚生年金_標準報酬月額': grade.pensionStandardRemuneration,
        '備考': `転勤（${from.name}から）`,
        '備考項目': acquisitionRemarkItems({ age70: false, otherEmployer: !!employee.otherEmployer, shortTime: false }),
        ...ledger,
      }));
    }
    let steps = setStep(latest.steps, 'apply', { ...completed(auth.uid), statusDetail: `${to.name}に変更` });
    steps = setStep(steps, 'filings', t.filingRequired ? { status: 'in_progress', statusDetail: '承認と提出を待っています' } : { status: 'skipped', statusDetail: '届出は不要' });
    steps = setStep(steps, 'confirm', { status: t.filingRequired ? 'blocked' : 'available' });
    tx.update(ref, {
      officeId: t.toOfficeId, 'transfer.applied': true,
      'transfer.lossFilingId': lossRef?.id ?? null, 'transfer.acquisitionFilingId': acqRef?.id ?? null,
      steps, statusReason: statusReasonOf(steps), version: latest.version + 1, updatedAt: now,
    });
  });

  if (lossRef && acqRef && grade) {
    // 取得届の承認で、新しい事業所での等級（今の等級を引き継ぐ）も確定する
    await createApprovalRequest({
      companyId: input.companyId, employeeId: proc.employeeId!, targetPath: lossRef.path, targetVersion: 1, requestType: 'filing',
      comment: `${proc.employeeName}さんの資格喪失届（転勤、${from.name}）`, metadata: { source: 'transfer', procedureId: input.procedureId },
    }, auth);
    await createApprovalRequest({
      companyId: input.companyId, employeeId: proc.employeeId!, targetPath: acqRef.path, targetVersion: 1, requestType: 'filing',
      comment: `${proc.employeeName}さんの資格取得届（転勤、${to.name}）`,
      metadata: {
        source: 'transfer', procedureId: input.procedureId,
        grade: {
          path: `${empRef.path}/grades/${effectiveMonth}`, effectiveMonth, determinationType: 'initial',
          healthGradeNumber: grade.healthGradeNumber, healthStandardRemuneration: grade.healthStandardRemuneration,
          pensionGradeNumber: grade.pensionGradeNumber, pensionStandardRemuneration: grade.pensionStandardRemuneration,
          basisRemuneration: grade.basisRemuneration ?? null, reason: `転勤による資格取得（${from.name}の等級を引き継ぐ）`,
        },
      },
    }, auth);
  }
  return { success: true };
}

// ── 完了 ────────────────────────────────────────────

export async function completeTransfer(input: { companyId: string; procedureId: string; expectedVersion: number }, auth: AuthContext) {
  const { ref, proc } = await loadProcedure(input.companyId, input.procedureId, auth);
  requireVersion(proc, input.expectedVersion);
  if (stepOf(proc, 'confirm').status !== 'available') throw invalidArg('届出の提出が済んでから完了にしてください');
  const now = Timestamp.now();
  const steps = setStep(proc.steps, 'confirm', completed(auth.uid));
  await db.runTransaction(async tx => {
    const latest = (await tx.get(ref)).data() as TransferProc;
    requireVersion(latest, input.expectedVersion);
    tx.update(ref, { steps, status: 'completed', statusReason: '異動を完了した', completedAt: now, updatedAt: now, version: latest.version + 1 });
  });
  return { success: true };
}
