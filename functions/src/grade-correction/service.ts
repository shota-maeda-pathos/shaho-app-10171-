import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../config';
import { AuthContext, requireOffice } from '../middleware/auth';
import { EmployeeDoc, FilingDoc, GradeCorrectionState, GradeDoc, ProcedureDoc } from '../types/firestore';
import { invalidArg, notFound } from '../utils/errors';
import { findGradeByNumber, resolveGradeTable } from '../insurance/calculator';
import { calculateMonthlyInsurance } from '../insurance/monthly-insurance-calculate/service';
import { createApprovalRequest } from '../approvals/approval-request-create/service';
import { requestManualGrade } from '../grades/manual-grade';
import { reopenPremium } from '../monthly/service';
import { buildGradeCorrectionSteps } from '../procedures/templates';
import { requireProcedureAccess } from '../procedures/access';
import { completed, requireVersion, setStep, statusReasonOf, stepOf } from '../procedures/wizard';
import { ImpactMonth, PremiumState, REASON_LABELS, monthsInRange, settlementOf, totals } from './rules';

type CorrectionProc = ProcedureDoc & { gradeCorrection: GradeCorrectionState };
const nameOf = (e: { lastName: string; firstName: string }) => `${e.lastName} ${e.firstName}`;
const stateOf = (d: FirebaseFirestore.DocumentData): PremiumState => (d.isConfirmed === true ? 'confirmed' : d.approvalPending === true ? 'pending' : 'unconfirmed');

// ── 開始 ────────────────────────────────────────────

export async function startGradeCorrection(input: { employeeId: string }, auth: AuthContext) {
  const base = `companies/${auth.companyId}`;
  const empSnap = await db.doc(`${base}/employees/${input.employeeId}`).get();
  if (!empSnap.exists || empSnap.data()!.deletedAt !== null) throw notFound('従業員');
  const employee = empSnap.data() as EmployeeDoc;
  requireOffice(auth, employee.officeId);
  const existing = await db.collection(`${base}/procedures`).where('employeeId', '==', input.employeeId).where('deletedAt', '==', null).get();
  const open = existing.docs.find(d => !!(d.data() as ProcedureDoc).gradeCorrection && d.data().status === 'in_progress');
  if (open) return { procedureId: open.id, existing: true };

  const name = nameOf(employee);
  const now = Timestamp.now();
  const ref = db.collection(`${base}/procedures`).doc();
  const steps = buildGradeCorrectionSteps();
  const batch = db.batch();
  batch.set(ref, {
    procedureType: 'grade_correction', title: `${name} 等級の遡及訂正`, priority: 'normal', status: 'in_progress', statusReason: statusReasonOf(steps),
    employeeId: input.employeeId, employeeName: name, officeId: employee.officeId, targetOfficeId: null, scope: 'individual',
    batchMeta: null, invitationId: null, onboardToken: null, steps, deadline: null, effectiveDate: null,
    assignedTo: auth.uid, createdBy: auth.uid, references: [], notes: '', version: 1,
    createdAt: now, updatedAt: now, completedAt: null, deletedAt: null,
    gradeCorrection: {
      reasonType: 'pensionOffice', reason: '', effectiveMonth: null, healthGradeNumber: null, pensionGradeNumber: null, before: null,
      approvalRequestId: null, correctedMonths: [], diffs: [], settlement: null,
    },
  } satisfies ProcedureDoc);
  batch.set(db.collection(`${base}/auditLogs`).doc(), {
    entity: 'procedure', entityId: ref.id, action: 'create', changes: { procedureType: { from: null, to: 'grade_correction' } }, performedBy: auth.uid, performedAt: now, version: 1,
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
  if (!proc.gradeCorrection || !proc.employeeId) throw invalidArg('この手続きは等級の遡及訂正の画面では扱えません');
  return { ref, proc: proc as CorrectionProc };
}

export type CorrectionStepKey = 'entry' | 'grade_approval' | 'correct' | 'settle' | 'done';

export function currentCorrectionStep(proc: ProcedureDoc): CorrectionStepKey {
  if (proc.status === 'completed') return 'done';
  for (const id of ['entry', 'grade_approval', 'correct'] as const) if (stepOf(proc, id).status !== 'completed') return id;
  return 'settle';
}

function gradeOf(health: number, pension: number) {
  const h = findGradeByNumber(resolveGradeTable('health'), health);
  const p = findGradeByNumber(resolveGradeTable('pension'), pension);
  if (!h || !p) throw invalidArg('等級の番号が等級表にありません');
  return { healthGradeNumber: h.gradeNumber, healthStandardRemuneration: h.standardRemuneration, pensionGradeNumber: p.gradeNumber, pensionStandardRemuneration: p.standardRemuneration };
}

/**
 * 影響の一覧（カタログ6章 ①〜③）：直した等級が効く月のうち計算済みの月、月ごとの前後の額と徴収済みの額、関係する届出。
 * grade を渡すとその等級で試し計算する（承認の前）。渡さなければ今の等級で計算する（承認の後）
 */
export async function impactOf(auth: AuthContext, employeeId: string, effectiveMonth: string, grade?: ReturnType<typeof gradeOf>) {
  const emp = `companies/${auth.companyId}/employees/${employeeId}`;
  const [gradesSnap, premiums] = await Promise.all([
    db.collection(`${emp}/grades`).get(),
    db.collection(`${emp}/monthlyInsurance`).where('yearMonth', '>=', effectiveMonth).get(),
  ]);
  const grades = gradesSnap.docs.map(d => d.data() as GradeDoc).sort((a, b) => a.effectiveMonth.localeCompare(b.effectiveMonth));
  const before = [...grades].reverse().find(g => g.effectiveMonth <= effectiveMonth) ?? null;
  const next = grades.find(g => g.effectiveMonth > effectiveMonth)?.effectiveMonth ?? null;
  const byMonth = new Map(premiums.docs.map(d => [d.id, d.data()]));
  const months = monthsInRange([...byMonth.keys()], effectiveMonth, next);
  const receipts = months.length ? await db.getAll(...months.map(m => db.doc(`${emp}/collectionReceipts/${m}`))) : [];

  const items: ImpactMonth[] = [];
  for (const [i, m] of months.entries()) {
    const p = byMonth.get(m)!;
    let after: { totalEmployeeAmount: number; totalEmployerAmount: number } | null = null;
    let error: string | null = null;
    try {
      const r = await calculateMonthlyInsurance({ companyId: auth.companyId, employeeId, yearMonth: m }, auth, { dryRun: true, grade });
      after = r.preview ?? null;
    } catch (e) {
      error = (e as Error).message;
    }
    const c = receipts[i]?.data()?.collectedAmount;
    items.push({
      yearMonth: m, state: stateOf(p), beforeEmployee: p.totalEmployeeAmount ?? 0, beforeEmployer: p.totalEmployerAmount ?? 0,
      afterEmployee: after?.totalEmployeeAmount ?? null, afterEmployer: after?.totalEmployerAmount ?? null,
      collected: typeof c === 'number' ? c : null, error,
    });
  }

  // 関係する届出：直す前の等級を決めた届出（訂正届を作る）。定時決定の等級なら算定基礎届（事業所単位）
  const filings: { id: string; filingType: string; label: string; status: string }[] = [];
  if (before?.filingId) {
    const f = await db.doc(`${emp}/filings/${before.filingId}`).get();
    if (f.exists) {
      const fd = f.data() as FilingDoc;
      filings.push({ id: f.id, filingType: fd.filingType, label: '直す前の等級を決めた届出', status: fd.mockStatus === 'completed' || fd.submissionStatus === 'accepted' ? 'submitted' : fd.workflowStatus });
    }
  }
  const notes: string[] = [];
  if (before?.determinationType === 'regular') notes.push(`直す前の等級は${before.effectiveMonth.slice(0, 4)}年の定時決定（算定基礎届）で決めた等級です。算定基礎届の訂正は届出の画面では作れないため、年金事務所に確かめてください。`);
  if (items.some(x => x.state === 'pending')) notes.push('確認を依頼中の月があります。毎月の処理で差し戻してから直してください（まとめて直すときは飛ばします）。');
  if (!items.length) notes.push('この等級が効く月で、計算済みの保険料はありません。承認されたら等級だけが直ります。');

  return {
    before: before ? {
      effectiveMonth: before.effectiveMonth, healthGradeNumber: before.healthGradeNumber, healthStandardRemuneration: before.healthStandardRemuneration,
      pensionGradeNumber: before.pensionGradeNumber, pensionStandardRemuneration: before.pensionStandardRemuneration,
      determinationType: before.determinationType, filingId: before.filingId ?? null,
    } : null,
    nextGradeMonth: next,
    months: items.map(x => ({ ...x, settlement: settlementOf(x) })),
    totals: totals(items),
    filings, notes,
  };
}

export async function previewGradeCorrection(input: { companyId: string; procedureId: string; effectiveMonth: string; healthGradeNumber: number; pensionGradeNumber: number }, auth: AuthContext) {
  const { proc } = await loadProcedure(input.companyId, input.procedureId, auth);
  return impactOf(auth, proc.employeeId!, input.effectiveMonth, gradeOf(input.healthGradeNumber, input.pensionGradeNumber));
}

async function approvalStatus(companyId: string, employeeId: string, requestId: string | null) {
  if (!requestId) return null;
  const s = await db.doc(`companies/${companyId}/employees/${employeeId}/approvalRequests/${requestId}`).get();
  if (!s.exists) return null;
  const d = s.data()!;
  return { status: d.status as string, comment: (d.status === 'rejected' ? d.comment : null) as string | null };
}

export async function getGradeCorrection(companyId: string, procedureId: string, auth: AuthContext) {
  const { ref, proc: loaded } = await loadProcedure(companyId, procedureId, auth);
  let proc = loaded;
  const g = proc.gradeCorrection;
  const approval = await approvalStatus(companyId, proc.employeeId!, g.approvalRequestId);
  // 等級が承認されたら承認のステップを終え、差し戻されたら入力に戻す
  if (proc.status === 'in_progress' && stepOf(proc, 'grade_approval').status !== 'completed' && approval && approval.status !== 'pending') {
    await db.runTransaction(async tx => {
      const latest = (await tx.get(ref)).data() as CorrectionProc;
      let steps = latest.steps;
      if (approval.status === 'approved') {
        steps = setStep(steps, 'grade_approval', { ...completed(auth.uid), statusDetail: '等級を確定した' });
        steps = setStep(steps, 'correct', { status: 'available' });
      } else {
        steps = setStep(steps, 'entry', { status: 'returned', completedAt: null, completedBy: null, statusDetail: `差し戻し：${approval.comment ?? ''}` });
        steps = setStep(steps, 'grade_approval', { status: 'blocked', statusDetail: null });
      }
      tx.update(ref, {
        steps, statusReason: statusReasonOf(steps), version: latest.version + 1, updatedAt: Timestamp.now(),
        ...(approval.status === 'approved' ? {} : { 'gradeCorrection.approvalRequestId': null }),
      });
    });
    proc = (await ref.get()).data() as CorrectionProc;
  }
  const empSnap = await db.doc(`companies/${companyId}/employees/${proc.employeeId}`).get();
  const e = empSnap.data() as EmployeeDoc;
  const current = currentCorrectionStep(proc);
  const gc = proc.gradeCorrection;
  // 承認の後は今の等級で計算し直した額、承認の前は入れた等級での試し計算
  const impact = gc.effectiveMonth && gc.healthGradeNumber && gc.pensionGradeNumber && (current === 'grade_approval' || current === 'correct')
    ? await impactOf(auth, proc.employeeId!, gc.effectiveMonth, current === 'grade_approval' ? gradeOf(gc.healthGradeNumber, gc.pensionGradeNumber) : undefined)
    : null;
  return {
    procedure: { id: procedureId, version: proc.version, status: proc.status, title: proc.title, employeeName: proc.employeeName },
    current,
    steps: proc.steps.map(s => ({ id: s.id, label: s.label, status: s.status, statusDetail: s.statusDetail })),
    employee: { id: proc.employeeId!, employeeNumber: e.employeeNumber, name: nameOf(e) },
    entry: gc,
    reasonLabel: REASON_LABELS[gc.reasonType],
    approval: approval ?? (stepOf(proc, 'entry').status === 'returned' ? { status: 'rejected', comment: stepOf(proc, 'entry').statusDetail } : null),
    impact,
    settlementTotal: gc.diffs.reduce((a, d) => a + settlementOf({ beforeEmployee: d.beforeEmployee, afterEmployee: d.afterEmployee, collected: d.collected }), 0),
  };
}

// ── 等級を入れて承認を依頼する ─────────────────────────────

export async function saveCorrectionEntry(input: { companyId: string; procedureId: string; expectedVersion: number; effectiveMonth: string; healthGradeNumber: number; pensionGradeNumber: number; reasonType: 'pensionOffice' | 'error'; reason: string }, auth: AuthContext) {
  const { ref, proc } = await loadProcedure(input.companyId, input.procedureId, auth);
  requireVersion(proc, input.expectedVersion);
  if (stepOf(proc, 'entry').status === 'completed') throw invalidArg('等級の承認を依頼済みです。差し戻されたら直せます');
  const grade = gradeOf(input.healthGradeNumber, input.pensionGradeNumber);
  const impact = await impactOf(auth, proc.employeeId!, input.effectiveMonth, grade);
  const b = impact.before;
  if (b && b.effectiveMonth === input.effectiveMonth && b.healthGradeNumber === grade.healthGradeNumber && b.pensionGradeNumber === grade.pensionGradeNumber) {
    throw invalidArg('今の等級と同じです。直す等級を入れてください');
  }
  // 同じ適用月の等級があればその決定の種類のまま上書きし、なければ「その他」の等級として足す
  const sameMonth = b?.effectiveMonth === input.effectiveMonth;
  const { id: approvalRequestId } = await requestManualGrade({
    companyId: input.companyId, employeeId: proc.employeeId!, effectiveMonth: input.effectiveMonth,
    healthGradeNumber: grade.healthGradeNumber, pensionGradeNumber: grade.pensionGradeNumber,
    determinationType: sameMonth ? b!.determinationType : 'specific',
    reason: `遡及訂正（${REASON_LABELS[input.reasonType]}）：${input.reason}`,
  }, auth);
  await db.runTransaction(async tx => {
    const latest = (await tx.get(ref)).data() as CorrectionProc;
    requireVersion(latest, input.expectedVersion);
    let steps = setStep(latest.steps, 'entry', { ...completed(auth.uid), statusDetail: `${input.effectiveMonth}から健保${grade.healthGradeNumber}・厚年${grade.pensionGradeNumber}等級` });
    steps = setStep(steps, 'grade_approval', { status: 'in_progress', statusDetail: '承認を待っています' });
    tx.update(ref, {
      'gradeCorrection.reasonType': input.reasonType, 'gradeCorrection.reason': input.reason, 'gradeCorrection.effectiveMonth': input.effectiveMonth,
      'gradeCorrection.healthGradeNumber': grade.healthGradeNumber, 'gradeCorrection.pensionGradeNumber': grade.pensionGradeNumber,
      'gradeCorrection.before': b ? { healthGradeNumber: b.healthGradeNumber, healthStandardRemuneration: b.healthStandardRemuneration, pensionGradeNumber: b.pensionGradeNumber, pensionStandardRemuneration: b.pensionStandardRemuneration, determinationType: b.determinationType, filingId: b.filingId } : null,
      'gradeCorrection.approvalRequestId': approvalRequestId,
      effectiveDate: Timestamp.fromDate(new Date(`${input.effectiveMonth}-01T00:00:00Z`)),
      steps, statusReason: statusReasonOf(steps), version: latest.version + 1, updatedAt: Timestamp.now(),
    });
  });
  return { success: true, approvalRequestId };
}

// ── 影響する月をまとめて直す ──────────────────────────────

/**
 * 確定済みの月は訂正（未確定に戻して前の内容を履歴に残す）→ 今の等級で計算し直す → 確認を依頼する。未確定の月は計算し直すだけ。
 * 依頼中の月は飛ばす（差し戻してから）。1か月ずつ進め、失敗した月は理由を返す（やり直せる）
 */
export async function correctMonths(input: { companyId: string; procedureId: string; expectedVersion: number }, auth: AuthContext) {
  const { ref, proc } = await loadProcedure(input.companyId, input.procedureId, auth);
  requireVersion(proc, input.expectedVersion);
  if (stepOf(proc, 'correct').status !== 'available' && stepOf(proc, 'correct').status !== 'in_progress') throw invalidArg('等級が承認されてから直せます');
  const g = proc.gradeCorrection;
  const employeeId = proc.employeeId!;
  const emp = `companies/${input.companyId}/employees/${employeeId}`;
  const impact = await impactOf(auth, employeeId, g.effectiveMonth!);
  const reason = `等級の遡及訂正（${REASON_LABELS[g.reasonType]}）：${g.reason}`;
  const done: string[] = [...g.correctedMonths];
  const diffs = [...g.diffs];
  const failures: { yearMonth: string; message: string }[] = [];
  for (const m of impact.months) {
    if (done.includes(m.yearMonth)) continue;
    if (m.state === 'pending') { failures.push({ yearMonth: m.yearMonth, message: '確認を依頼中です。毎月の処理で差し戻してから、もう一度押してください' }); continue; }
    try {
      const wasConfirmed = await reopenPremium(auth, employeeId, m.yearMonth, reason);
      await calculateMonthlyInsurance({ companyId: input.companyId, employeeId, yearMonth: m.yearMonth }, auth);
      const after = (await db.doc(`${emp}/monthlyInsurance/${m.yearMonth}`).get()).data()!;
      if (wasConfirmed) {
        await createApprovalRequest({
          companyId: input.companyId, employeeId, requestType: 'monthlyInsurance', targetPath: `${emp}/monthlyInsurance/${m.yearMonth}`, targetVersion: after.version,
          comment: `${proc.employeeName}さんの${m.yearMonth}分の保険料（${reason}）`,
        }, auth, { notify: false });
      }
      done.push(m.yearMonth);
      diffs.push({ yearMonth: m.yearMonth, beforeEmployee: m.beforeEmployee, beforeEmployer: m.beforeEmployer, afterEmployee: after.totalEmployeeAmount ?? 0, afterEmployer: after.totalEmployerAmount ?? 0, collected: m.collected });
    } catch (e) {
      failures.push({ yearMonth: m.yearMonth, message: (e as Error).message });
    }
  }
  const now = Timestamp.now();
  await db.runTransaction(async tx => {
    const latest = (await tx.get(ref)).data() as CorrectionProc;
    let steps = latest.steps;
    if (failures.length) steps = setStep(steps, 'correct', { status: 'in_progress', statusDetail: `${done.length}か月を直した。${failures.length}か月が残っている` });
    else {
      steps = setStep(steps, 'correct', { ...completed(auth.uid), statusDetail: done.length ? `${done.length}か月を直した` : '直す月はなかった' });
      steps = setStep(steps, 'settle', { status: 'available' });
    }
    tx.update(ref, { 'gradeCorrection.correctedMonths': done, 'gradeCorrection.diffs': diffs, steps, statusReason: statusReasonOf(steps), version: latest.version + 1, updatedAt: now });
    tx.set(db.collection(`companies/${input.companyId}/auditLogs`).doc(), {
      entity: 'procedure', entityId: input.procedureId, action: 'gradeCorrectionApply', employeeId,
      changes: { correctedMonths: { from: g.correctedMonths, to: done }, failures: failures.map(f => f.yearMonth) }, performedBy: auth.uid, performedAt: now, version: latest.version + 1,
    });
  });
  return { success: true, corrected: done.length - g.correctedMonths.length, failures };
}

// ── 精算の方法を記録して完了 ──────────────────────────────

export async function settleCorrection(input: { companyId: string; procedureId: string; expectedVersion: number; method: 'nextPayroll' | 'separate' | 'none'; payMonth: string | null; note: string }, auth: AuthContext) {
  const { ref, proc } = await loadProcedure(input.companyId, input.procedureId, auth);
  requireVersion(proc, input.expectedVersion);
  if (stepOf(proc, 'settle').status !== 'available') throw invalidArg('影響する月の保険料を直してから記録してください');
  if (input.method === 'nextPayroll' && !input.payMonth) throw invalidArg('調整する給与の支給月を入れてください');
  const g = proc.gradeCorrection;
  const amount = g.diffs.reduce((a, d) => a + settlementOf({ beforeEmployee: d.beforeEmployee, afterEmployee: d.afterEmployee, collected: d.collected }), 0);
  if (amount !== 0 && input.method === 'none') throw invalidArg('差額があります。精算の方法を選んでください');
  const now = Timestamp.now();
  const settlement = { method: input.method, payMonth: input.method === 'nextPayroll' ? input.payMonth : null, amount, note: input.note };
  await db.runTransaction(async tx => {
    const latest = (await tx.get(ref)).data() as CorrectionProc;
    requireVersion(latest, input.expectedVersion);
    const steps = setStep(latest.steps, 'settle', { ...completed(auth.uid), statusDetail: input.method === 'nextPayroll' ? `${input.payMonth}支給の給与で調整` : input.method === 'separate' ? '別に精算' : '差額なし' });
    tx.update(ref, { 'gradeCorrection.settlement': settlement, steps, status: 'completed', statusReason: '等級の遡及訂正を完了した', completedAt: now, updatedAt: now, version: latest.version + 1 });
    tx.set(db.collection(`companies/${input.companyId}/auditLogs`).doc(), {
      entity: 'procedure', entityId: input.procedureId, action: 'gradeCorrectionSettle', employeeId: proc.employeeId,
      changes: { settlement: { from: null, to: settlement } }, performedBy: auth.uid, performedAt: now, version: latest.version + 1,
    });
  });
  return { success: true, settlement };
}
