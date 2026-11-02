// 算定基礎届（定時決定）。一括型：事業所×年ごとに、対象者を確かめる → 等級の承認 → 届出を作る → 届出の承認と提出
import { filingContentHash } from '../utils/hash';
import { buildArchive } from '../filings/archive/rules';
import { RunCorrectionSummary, runCorrectionSummary } from '../filings/run-correction/rules';
import { laborConsultantText } from '../companies/labor-consultant';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from '../config';
import { AuthContext, requireOffice } from '../middleware/auth';
import { ApprovalRequestDoc, EmployeeDoc, EmploymentDoc, GradeDoc, OfficeDoc, SalaryDoc } from '../types/firestore';
import { invalidArg, notFound } from '../utils/errors';
import { findApplicableRate } from '../utils/insurance-rate';
import { normalizeEmployment, qualificationDates, toDateString } from '../utils/employment';
import { isPensionExcluded } from '../utils/age';
import { resolveGradeTable } from '../insurance/calculator';
import { createApprovalRequest } from '../approvals/approval-request-create/service';
import { approveApprovalRequest } from '../approvals/approval-request-approve/service';
import { mapConcurrent } from '../utils/parallel';
import { authOf, getAllChunked } from '../monthly/service';
import {
  computeSanteiRow, NO_APPROVAL, SanteiApproval, SanteiApprovalMetadata, SanteiDecision, SanteiEmployeeData, SanteiFilingPerson, SanteiRow,
  santeiApprovalMetadata, santeiCurrentGradeMonth, santeiEffectiveMonth, santeiFilingPerson, santeiFilingPeriod, santeiMetadataMatches,
} from './santei-calc';
import {
  SanteiAction, SanteiDecisionInput, SanteiFilingGetInput, SanteiFilingUpdateInput, SanteiHoldInput, SanteiJobGetInput, SanteiJobStartInput,
  SanteiRunInput,
} from './schema';

/** 1つの事業所で扱える人数の上限（毎月の処理と同じ） */
export const MAX_SANTEI_TARGETS = 3000;
/** 1件の届出に載せる人数の上限（文書の大きさの上限のため） */
const MAX_FILING_PERSONS = 1000;
const CHUNK_SIZE = 25;
const STALE_MS = 10 * 60_000;

const base = (companyId: string) => `companies/${companyId}`;
export const santeiRunId = (officeId: string, year: number) => `${officeId}_${year}`;
const nameOf = (e: EmployeeDoc) => `${e.lastName ?? ''} ${e.firstName ?? ''}`.trim();
const iso = (v: unknown) => (v as Timestamp | undefined)?.toDate?.().toISOString() ?? null;

/** 定時決定の承認対象パス（等級の文書IDは適用開始月） */
export function santeiGradePath(companyId: string, employeeId: string, year: number): string {
  return `${base(companyId)}/employees/${employeeId}/grades/${santeiEffectiveMonth(year)}`;
}

async function loadRun(input: SanteiRunInput, auth: AuthContext) {
  requireOffice(auth, input.officeId);
  const office = await db.doc(`${base(auth.companyId)}/offices/${input.officeId}`).get();
  if (!office.exists) throw notFound('事業所');
  const runRef = db.doc(`${base(auth.companyId)}/santeiRuns/${santeiRunId(input.officeId, input.year)}`);
  return { office: office.data() as OfficeDoc, runRef };
}

async function gradeTables(companyId: string, office: OfficeDoc | undefined, year: number) {
  const ym = santeiEffectiveMonth(year);
  const [health, pension] = await Promise.all([
    findApplicableRate({ companyId, insuranceType: 'health', yearMonth: ym, prefectureCode: office?.prefectureCode, insurerId: office?.insurerId }),
    findApplicableRate({ companyId, insuranceType: 'pension', yearMonth: ym }),
  ]);
  return { health: resolveGradeTable('health', health?.gradeTable), pension: resolveGradeTable('pension', pension?.gradeTable) };
}

/** 定時決定の承認申請の状態。申請中・承認済みがあればそれ、なければ最後の差し戻し */
function approvalOf(docs: FirebaseFirestore.QueryDocumentSnapshot[]): SanteiApproval {
  const list = docs.map(d => ({ id: d.id, ...(d.data() as ApprovalRequestDoc) }))
    .sort((a, b) => (b.requestedAt?.toMillis?.() ?? 0) - (a.requestedAt?.toMillis?.() ?? 0));
  const active = list.find(r => r.status === 'pending') ?? list.find(r => r.status === 'approved');
  if (active) return { status: active.status as 'pending' | 'approved', requestId: active.id, requestedBy: active.requestedBy ?? null, rejection: null };
  const rejected = list.find(r => r.status === 'rejected');
  if (rejected) return { status: 'rejected', requestId: rejected.id, requestedBy: rejected.requestedBy ?? null, rejection: String(rejected.comment || '理由の記入なし') };
  return NO_APPROVAL;
}

/** 1人分の判定に使うデータ。給与は支給月（4〜6月に支払ったもの） */
async function loadEmployeeData(companyId: string, employeeId: string, employee: EmployeeDoc, year: number, decision: SanteiDecision | null) {
  const empPath = `${base(companyId)}/employees/${employeeId}`;
  const months = ['04', '05', '06'].map(m => `${year}-${m}`);
  const [employmentSnap, gradeSnap, revisionSnap, approvalSnap, septemberGrade, ...salarySnaps] = await Promise.all([
    db.collection(`${empPath}/employments`).where('effectiveDate', '<=', `${year}-07-01`).orderBy('effectiveDate', 'desc').limit(1).get(),
    db.collection(`${empPath}/grades`).where('effectiveMonth', '<=', santeiCurrentGradeMonth(year)).orderBy('effectiveMonth', 'desc').limit(1).get(),
    db.collection(`${empPath}/grades`).where('effectiveMonth', '>=', `${year}-07`).where('effectiveMonth', '<=', `${year}-09`).get(),
    db.collection(`${empPath}/approvalRequests`).where('targetPath', '==', santeiGradePath(companyId, employeeId, year)).get(),
    db.doc(santeiGradePath(companyId, employeeId, year)).get(),
    ...months.map(ym => db.doc(`${empPath}/salaries/${ym}`).get()),
  ]);
  const employment = employmentSnap.empty ? null : normalizeEmployment(employmentSnap.docs[0].data() as EmploymentDoc);
  const { acquisitionDate, lossDate } = qualificationDates(employee);
  const approval = approvalOf(approvalSnap.docs);
  const data: SanteiEmployeeData = {
    employeeId,
    employeeNumber: employee.employeeNumber,
    employeeName: nameOf(employee),
    acquisitionDate,
    lossDate,
    enrolled: employment === null || employment.healthInsuranceEnrolled || employment.pensionEnrolled,
    insuredCategory: employment?.insuredCategory ?? 'general',
    salaries: Object.fromEntries(months.map((ym, i) => [ym, salarySnaps[i].exists ? salarySnaps[i].data() as SalaryDoc : null])),
    currentGrade: gradeSnap.empty ? null : gradeSnap.docs[0].data() as GradeDoc,
    hasOccasionalRevisionJulToSep: revisionSnap.docs.some(d => (d.data() as GradeDoc).determinationType === 'occasional'),
    approval,
    decision,
  };
  // 9月の等級が定時決定の承認以外（手入力など）で既にある
  const sep = septemberGrade.data();
  const septemberTaken = !!sep && !(approval.status === 'approved' && sep.approvalRequestId === approval.requestId);
  return { data, septemberTaken };
}

/** 4月1日〜7月1日に在籍していた人（それ以外は一覧に出さない） */
function inSanteiPeriod(employee: EmployeeDoc, year: number) {
  const { acquisitionDate, lossDate } = qualificationDates(employee);
  if (acquisitionDate && acquisitionDate > `${year}-07-01`) return false;
  return !lossDate || lossDate > `${year}-04-01`;
}

export interface SanteiOverviewRow extends SanteiRow {
  hold: { reason: string } | null;
  /** 載っている届出（取り消したものは除く） */
  filingId: string | null;
  /** 9月の等級が定時決定以外で登録済み */
  septemberTaken: boolean;
}

export interface SanteiFilingSummary {
  id: string;
  number: number;
  status: 'draft' | 'pending' | 'approved' | 'submitted' | 'cancelled';
  personCount: number;
  requestedBy: string | null;
  requestedAt: string | null;
  mine: boolean;
  rejection: string | null;
  submission: { method: 'mock' | 'paper'; date: string; acceptanceNumber: string | null } | null;
  /** 模擬電子申請の状態（送信中・送信エラー・返戻など。届出の画面の提出の部品が詳しく出す） */
  mockStatus: string | null;
  /** 訂正届・取消届まわり */
  correction: RunCorrectionSummary;
  version: number;
  createdAt: string | null;
}

function filingSummary(d: FirebaseFirestore.DocumentSnapshot, auth: AuthContext): SanteiFilingSummary {
  const f = d.data()!;
  return {
    id: d.id, number: f.number, status: f.status, personCount: (f.employeeIds ?? []).length,
    requestedBy: f.requestedBy ?? null, requestedAt: iso(f.requestedAt), mine: f.requestedBy === auth.uid,
    rejection: f.rejection?.comment ?? null,
    submission: f.submission ? { method: f.submission.method, date: f.submission.date, acceptanceNumber: f.submission.acceptanceNumber ?? null } : null,
    mockStatus: f.mock?.status ?? null,
    correction: runCorrectionSummary(f),
    version: f.version, createdAt: iso(f.createdAt),
  };
}

/** 事業所×年の状況（全員分）。判定はすべてサーバーで行う */
export async function santeiOverview(input: SanteiRunInput, auth: AuthContext) {
  const { office, runRef } = await loadRun(input, auth);
  const companyBase = base(auth.companyId);
  const employeesSnap = await db.collection(`${companyBase}/employees`)
    .where('officeId', '==', input.officeId).where('deletedAt', '==', null)
    .orderBy('employeeNumber', 'asc').limit(MAX_SANTEI_TARGETS + 1).get();
  if (employeesSnap.size > MAX_SANTEI_TARGETS) throw invalidArg(`この事業所の従業員が${MAX_SANTEI_TARGETS}名を超えています。事業所を分けて処理してください`);
  const employees = employeesSnap.docs.filter(d => inSanteiPeriod(d.data() as EmployeeDoc, input.year));

  const [run, holds, decisions, filings, tables] = await Promise.all([
    runRef.get(),
    runRef.collection('holds').get(),
    runRef.collection('decisions').get(),
    runRef.collection('filings').orderBy('number', 'asc').get(),
    gradeTables(auth.companyId, office, input.year),
  ]);
  const holdOf = new Map(holds.docs.map(d => [d.id, d.data().reason as string]));
  const decisionOf = new Map(decisions.docs.map(d => [d.id, d.data().decision as SanteiDecision]));
  const filingOf = new Map<string, string>();
  for (const f of filings.docs) {
    // 訂正届・取消届は元の届出に載った人のもの。載っている届出は元の届出のまま
    if (f.data().status === 'cancelled' || f.data().originalFilingId) continue;
    for (const id of f.data().employeeIds ?? []) filingOf.set(id, f.id);
  }

  const rows = await mapConcurrent(employees, 20, async (doc): Promise<SanteiOverviewRow> => {
    const { data, septemberTaken } = await loadEmployeeData(auth.companyId, doc.id, doc.data() as EmployeeDoc, input.year, decisionOf.get(doc.id) ?? null);
    const row = computeSanteiRow(input.year, data, tables);
    return { ...row, hold: holdOf.has(doc.id) ? { reason: holdOf.get(doc.id)! } : null, filingId: filingOf.get(doc.id) ?? null, septemberTaken };
  });

  const runData = run.data() ?? {};
  return {
    office: { id: input.officeId, name: office.name ?? '' },
    year: input.year,
    effectiveMonth: santeiEffectiveMonth(input.year),
    filingPeriod: santeiFilingPeriod(input.year),
    gradeReview: runData.gradeReview ? { requestedBy: runData.gradeReview.requestedBy, requestedAt: iso(runData.gradeReview.requestedAt), mine: runData.gradeReview.requestedBy === auth.uid } : null,
    me: { uid: auth.uid, canApprove: auth.roles.some(r => r === 'admin' || r === 'approver') },
    rows,
    filings: filings.docs.map(d => filingSummary(d, auth)),
    job: runData.latestJobId ? await jobSummary(auth.companyId, runData.latestJobId) : null,
  };
}

async function requireEmployeeInOffice(tx: FirebaseFirestore.Transaction, companyId: string, employeeId: string, officeId: string) {
  const employee = await tx.get(db.doc(`${base(companyId)}/employees/${employeeId}`));
  if (!employee.exists || employee.data()!.deletedAt != null) throw notFound('従業員');
  if (employee.data()!.officeId !== officeId) throw invalidArg('対象の事業所が一致しません');
}

export async function setSanteiHold(input: SanteiHoldInput, auth: AuthContext) {
  const { runRef } = await loadRun(input, auth);
  const ref = runRef.collection('holds').doc(input.employeeId);
  await db.runTransaction(async tx => {
    await requireEmployeeInOffice(tx, auth.companyId, input.employeeId, input.officeId);
    const current = await tx.get(ref);
    const now = Timestamp.now();
    if (input.reason) tx.set(ref, { reason: input.reason, updatedBy: auth.uid, updatedAt: now });
    else tx.delete(ref);
    tx.set(runRef, { officeId: input.officeId, year: input.year, updatedAt: now }, { merge: true });
    tx.set(db.collection(`${base(auth.companyId)}/auditLogs`).doc(), {
      entity: 'santeiRun', entityId: runRef.id, employeeId: input.employeeId, action: 'update',
      changes: { hold: { from: current.data()?.reason ?? null, to: input.reason } }, performedBy: auth.uid, performedAt: now,
    });
  });
  return { success: true };
}

/** 支払基礎日数の基準を満たす月がない人を、従前の標準報酬月額で決める（担当者の判断） */
export async function setSanteiDecision(input: SanteiDecisionInput, auth: AuthContext) {
  const { runRef } = await loadRun(input, auth);
  const ids = [...new Set(input.employeeIds)];
  for (let i = 0; i < ids.length; i += 200) {
    const part = ids.slice(i, i + 200);
    const employees = await getAllChunked(part.map(id => db.doc(`${base(auth.companyId)}/employees/${id}`)));
    for (const e of employees) {
      if (!e.exists || e.data()!.deletedAt != null) throw notFound('従業員');
      if (e.data()!.officeId !== input.officeId) throw invalidArg('対象の事業所が一致しません');
    }
    const batch = db.batch();
    const now = Timestamp.now();
    for (const id of part) {
      const ref = runRef.collection('decisions').doc(id);
      if (input.decision) batch.set(ref, { decision: input.decision, updatedBy: auth.uid, updatedAt: now });
      else batch.delete(ref);
    }
    batch.set(db.collection(`${base(auth.companyId)}/auditLogs`).doc(), {
      entity: 'santeiRun', entityId: runRef.id, action: 'update', changes: { decision: { from: null, to: input.decision } },
      note: `${part.length}名`, performedBy: auth.uid, performedAt: now,
    });
    batch.set(runRef, { officeId: input.officeId, year: input.year, updatedAt: now }, { merge: true });
    await batch.commit();
  }
  return { success: true };
}

// ---- 一括処理（バックグラウンド） ----

const ACTION_LABEL: Record<SanteiAction, string> = { requestGradeApproval: '等級の承認の依頼', approveGrade: '等級の承認' };

export async function startSanteiJob(input: SanteiJobStartInput, auth: AuthContext) {
  const { runRef } = await loadRun(input, auth);
  if (input.action === 'approveGrade' && !auth.roles.some(r => r === 'admin' || r === 'approver')) throw invalidArg('承認できるのは管理者・承認者です');
  const ids = [...new Set(input.employeeIds)];
  const jobRef = db.collection(`${base(auth.companyId)}/santeiJobs`).doc();
  await db.runTransaction(async tx => {
    const run = await tx.get(runRef);
    const latest = run.data()?.latestJobId as string | undefined;
    if (latest) {
      const j = (await tx.get(db.doc(`${base(auth.companyId)}/santeiJobs/${latest}`))).data();
      if (j && j.status === 'running' && j.createdAt.toMillis() > Date.now() - STALE_MS) throw invalidArg('前の処理がまだ終わっていません。終わってから実行してください');
    }
    const now = Timestamp.now();
    const review = input.action === 'requestGradeApproval' ? { gradeReview: { requestedBy: auth.uid, requestedAt: now } } : {};
    tx.set(runRef, { officeId: input.officeId, year: input.year, latestJobId: jobRef.id, updatedAt: now, ...review }, { merge: true });
    tx.set(jobRef, {
      runId: runRef.id, officeId: input.officeId, year: input.year, action: input.action,
      total: ids.length, processed: 0, succeeded: 0, failed: 0, status: 'running',
      createdBy: auth.uid, createdAt: now, updatedAt: now, completedAt: null,
    });
    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      tx.set(db.doc(`${jobRef.path}/chunks/${String(i / CHUNK_SIZE).padStart(4, '0')}`), { employeeIds: ids.slice(i, i + CHUNK_SIZE), done: false, createdAt: now });
    }
  });
  return { jobId: jobRef.id };
}

async function jobSummary(companyId: string, jobId: string) {
  const job = await db.doc(`${base(companyId)}/santeiJobs/${jobId}`).get();
  if (!job.exists) return null;
  const j = job.data()!;
  const stalled = j.status === 'running' && j.createdAt.toMillis() < Date.now() - STALE_MS;
  return {
    id: job.id, action: j.action as SanteiAction, label: ACTION_LABEL[j.action as SanteiAction] ?? j.action,
    total: j.total, processed: j.processed, succeeded: j.succeeded, failed: j.failed,
    status: stalled ? 'stalled' : j.status as 'running' | 'completed', createdAt: iso(j.createdAt), completedAt: iso(j.completedAt),
  };
}

export async function getSanteiJob(input: SanteiJobGetInput, auth: AuthContext) {
  const { runRef } = await loadRun(input, auth);
  const job = await db.doc(`${base(auth.companyId)}/santeiJobs/${input.jobId}`).get();
  if (!job.exists || job.data()!.runId !== runRef.id) throw notFound('一括処理');
  const failures = await db.collection(`${job.ref.path}/failures`).limit(MAX_SANTEI_TARGETS).get();
  return {
    job: await jobSummary(auth.companyId, input.jobId),
    failures: failures.docs.map(d => ({ employeeId: d.id, message: d.data().message as string })),
  };
}

/** 1人分を今のデータで判定し直す（申請・承認の直前に必ず行う） */
async function currentRow(companyId: string, employeeId: string, officeId: string, year: number, runPath: string) {
  const [employee, hold, decision, office] = await getAllChunked([
    db.doc(`${base(companyId)}/employees/${employeeId}`), db.doc(`${runPath}/holds/${employeeId}`), db.doc(`${runPath}/decisions/${employeeId}`),
    db.doc(`${base(companyId)}/offices/${officeId}`),
  ]);
  if (!employee.exists || employee.data()!.deletedAt != null) throw notFound('従業員');
  if (employee.data()!.officeId !== officeId) throw invalidArg('対象の事業所が一致しません');
  if (hold.data()?.reason) throw invalidArg(`保留中です（${hold.data()!.reason}）`);
  const { data, septemberTaken } = await loadEmployeeData(companyId, employeeId, employee.data() as EmployeeDoc, year, (decision.data()?.decision as SanteiDecision) ?? null);
  const row = computeSanteiRow(year, data, await gradeTables(companyId, office.data() as OfficeDoc | undefined, year));
  return { row, septemberTaken };
}

async function processOne(action: SanteiAction, employeeId: string, job: FirebaseFirestore.DocumentData, auth: AuthContext) {
  const runPath = `${base(auth.companyId)}/santeiRuns/${job.runId}`;
  const { row, septemberTaken } = await currentRow(auth.companyId, employeeId, job.officeId, job.year, runPath);
  const targetPath = santeiGradePath(auth.companyId, employeeId, job.year);
  switch (action) {
    case 'requestGradeApproval': {
      if (row.approval.status === 'pending' || row.approval.status === 'approved') return;
      if (row.status !== 'ok') throw invalidArg(row.reason || '算定の対象ではありません');
      if (septemberTaken) throw invalidArg(`${santeiEffectiveMonth(job.year)}の等級が定時決定以外で既に登録されています。等級の画面で確かめてください`);
      await createApprovalRequest({
        companyId: auth.companyId, employeeId, targetPath, targetVersion: 0, requestType: 'grade',
        metadata: santeiApprovalMetadata(job.year, row),
      }, auth, { notify: false });
      return;
    }
    case 'approveGrade': {
      if (row.approval.status !== 'pending' || !row.approval.requestId) throw invalidArg(row.approval.status === 'approved' ? '承認済みです' : '承認の依頼がありません');
      const request = await db.doc(`${base(auth.companyId)}/employees/${employeeId}/approvalRequests/${row.approval.requestId}`).get();
      if (!santeiMetadataMatches(request.data()?.metadata, row)) throw invalidArg('承認を依頼した後に給与・等級が変わりました。差し戻してから依頼し直してください');
      if (septemberTaken) throw invalidArg(`${santeiEffectiveMonth(job.year)}の等級が定時決定以外で既に登録されています`);
      await approveApprovalRequest({ companyId: auth.companyId, employeeId, requestId: row.approval.requestId }, auth, { notify: false });
      return;
    }
  }
}

/** chunks の1件を処理する（Firestore のトリガーから呼ぶ） */
export async function processSanteiChunk(companyId: string, jobId: string, chunkId: string) {
  const jobRef = db.doc(`${base(companyId)}/santeiJobs/${jobId}`);
  const chunkRef = db.doc(`${jobRef.path}/chunks/${chunkId}`);
  const [job, chunk] = await Promise.all([jobRef.get(), chunkRef.get()]);
  if (!job.exists || !chunk.exists || chunk.data()!.done) return;
  const j = job.data()!;
  const ids: string[] = chunk.data()!.employeeIds ?? [];
  let auth: AuthContext | null = null;
  let authError = '';
  try { auth = await authOf(companyId, j.createdBy); } catch (e) { authError = (e as Error).message; }

  const results = await mapConcurrent(ids, 4, async id => {
    try {
      if (!auth) throw invalidArg(authError);
      await processOne(j.action, id, j, auth);
      return { id, ok: true, message: '' };
    } catch (e) {
      return { id, ok: false, message: (e as Error).message || '処理できませんでした' };
    }
  });
  const batch = db.batch();
  for (const r of results) {
    const ref = db.doc(`${jobRef.path}/failures/${r.id}`);
    if (r.ok) batch.delete(ref); else batch.set(ref, { message: r.message });
  }
  const failed = results.filter(r => !r.ok).length;
  batch.update(chunkRef, { done: true });
  batch.update(jobRef, {
    processed: FieldValue.increment(results.length), succeeded: FieldValue.increment(results.length - failed),
    failed: FieldValue.increment(failed), updatedAt: Timestamp.now(),
  });
  await batch.commit();

  const finished = await db.runTransaction(async tx => {
    const current = (await tx.get(jobRef)).data()!;
    if (current.status !== 'running' || current.processed < current.total) return null;
    tx.update(jobRef, { status: 'completed', completedAt: Timestamp.now() });
    return current;
  });
  if (finished) {
    const { notify } = await import('../utils/notify');
    const forReviewer = finished.action === 'requestGradeApproval';
    await notify({
      companyId, category: forReviewer ? 'approval' : 'system', targetType: 'santeiRun', targetId: finished.runId, officeId: finished.runId.replace(/_[^_]+$/, ''), createdBy: finished.createdBy,
      title: forReviewer ? '算定基礎届：等級の承認の依頼' : `算定基礎届：${ACTION_LABEL[finished.action as SanteiAction]}が終わりました`,
      body: `${finished.year}年の定時決定 ${finished.total}名中 ${finished.succeeded}名が完了${finished.failed ? `、${finished.failed}名が失敗` : ''}${forReviewer ? '。算定基礎届の画面で確認して承認してください' : ''}`,
    });
  }
}

// ---- 届出 ----

/**
 * 等級が承認された人をまとめて、算定基礎届を作る（事業所ごとに1件。後から承認された人は追加の届出にする）。
 * 中身は承認申請に記録した値（承認された値）から作る。
 */
export async function createSanteiFiling(input: SanteiRunInput, auth: AuthContext) {
  const { office, runRef } = await loadRun(input, auth);
  const overview = await santeiOverview(input, auth);
  const targets = overview.rows.filter(r => r.approval.status === 'approved' && !r.hold && !r.filingId);
  if (!targets.length) throw invalidArg('届出に載せる人がいません（等級が承認された人のうち、まだ届出に載っていない人が対象です）');

  const companyBase = base(auth.companyId);
  const [company, ...details] = await Promise.all([
    db.doc(companyBase).get(),
    ...targets.map(async r => {
      const [employee, request] = await getAllChunked([
        db.doc(`${companyBase}/employees/${r.employeeId}`), db.doc(`${companyBase}/employees/${r.employeeId}/approvalRequests/${r.approval.requestId}`),
      ]);
      const e = employee.data() as EmployeeDoc;
      const meta = request.data()?.metadata as SanteiApprovalMetadata | undefined;
      if (!meta?.months) throw invalidArg(`${r.employeeName}さんの承認の内容を読み取れません。差し戻して依頼し直してください`);
      return santeiFilingPerson({
        employeeId: r.employeeId, insuredPersonNumber: e.insuredPersonNumber ?? '', name: nameOf(e),
        birthDate: toDateString(e.birthDate) ?? '', meta, age70: !!e.birthDate && isPensionExcluded(e.birthDate, `${input.year}-07`),
      });
    }),
  ]);
  const header = {
    '事業所整理記号': office.officeNumber ?? '', '事業所番号': office.officeCode ?? '', '事業所名称': office.name ?? '', '事業所所在地': office.address ?? '',
    '電話番号': office.phone ?? '', '事業主氏名': company.data()?.representativeName ?? '', '会社名': company.data()?.name ?? '',
    '社会保険労務士': laborConsultantText(company.data()?.laborConsultant),
    '対象年': input.year, '適用年月': santeiEffectiveMonth(input.year),
  };

  const groups: SanteiFilingPerson[][] = [];
  for (let i = 0; i < details.length; i += MAX_FILING_PERSONS) groups.push(details.slice(i, i + MAX_FILING_PERSONS));
  const created = await db.runTransaction(async tx => {
    const run = await tx.get(runRef);
    const active = await tx.get(runRef.collection('filings').where('status', 'in', ['draft', 'pending', 'approved', 'submitted']));
    const filed = new Set(active.docs.flatMap(d => d.data().employeeIds as string[]));
    if (details.some(p => filed.has(p.employeeId))) throw invalidArg('ほかの操作で届出が作られました。画面を読み込み直してください');
    let number = (run.data()?.filingCount ?? 0) as number;
    const now = Timestamp.now();
    const ids: string[] = [];
    for (const persons of groups) {
      number += 1;
      const ref = runRef.collection('filings').doc();
      ids.push(ref.id);
      tx.set(ref, {
        number, officeId: input.officeId, year: input.year, filingType: 'remunerationMonthlyAlgorithm', status: 'draft',
        employeeIds: persons.map(p => p.employeeId), header, persons,
        requestedBy: null, requestedAt: null, approvedBy: null, approvedAt: null, rejection: null, submission: null,
        createdBy: auth.uid, createdAt: now, updatedAt: now, version: 1,
      });
      tx.set(db.collection(`${companyBase}/auditLogs`).doc(), {
        entity: 'santeiFiling', entityId: ref.id, action: 'create', changes: { persons: { from: null, to: persons.length } },
        performedBy: auth.uid, performedAt: now, version: 1,
      });
    }
    tx.set(runRef, { officeId: input.officeId, year: input.year, filingCount: number, updatedAt: now }, { merge: true });
    return ids;
  });
  return { filingIds: created, persons: details.length };
}

/** 模擬電子申請で確かめる項目。足りなければ受け付けない */
export function mockErrors(f: FirebaseFirestore.DocumentData): string[] {
  const errors: string[] = [];
  if (!f.header?.['事業所名称']) errors.push('事業所名称が未登録です');
  for (const p of (f.persons ?? []) as SanteiFilingPerson[]) {
    if (!p.被保険者氏名) errors.push(`${p.employeeId}：被保険者氏名がありません`);
    if (!p.生年月日) errors.push(`${p.被保険者氏名}：生年月日がありません`);
    if (p.平均額 === null && !p.備考) errors.push(`${p.被保険者氏名}：平均額も備考もありません`);
  }
  return errors;
}

/** 届出の承認と提出。承認は依頼した人とは別の管理者・承認者が行う */
export async function updateSanteiFiling(input: SanteiFilingUpdateInput, auth: AuthContext) {
  const { runRef } = await loadRun(input, auth);
  const ref = runRef.collection('filings').doc(input.filingId);
  const approver = auth.roles.some(r => r === 'admin' || r === 'approver');
  const operator = auth.roles.some(r => r === 'admin' || r === 'operator');
  const result = await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw notFound('届出');
    const f = snap.data()!;
    if (f.version !== input.expectedVersion) throw invalidArg('届出が更新されています。画面を読み込み直してください');
    const now = Timestamp.now();
    let patch: Record<string, unknown>;
    switch (input.action) {
      case 'requestApproval':
        if (!operator) throw invalidArg('承認を依頼できるのは管理者・担当者です');
        if (f.status !== 'draft') throw invalidArg('下書きの届出だけ承認を依頼できます');
        patch = { status: 'pending', requestedBy: auth.uid, requestedAt: now, rejection: null, approvalCancelledAt: null };
        break;
      case 'approve':
        if (!approver) throw invalidArg('承認できるのは管理者・承認者です');
        if (f.status !== 'pending') throw invalidArg('承認待ちの届出ではありません');
        if (f.requestedBy === auth.uid) throw invalidArg('自分が依頼した届出は自分では承認できません');
        patch = { status: 'approved', approvedBy: auth.uid, approvedAt: now, approvedHash: filingContentHash(f), approvalCancelledAt: null };
        break;
      case 'reject':
        if (!approver) throw invalidArg('差し戻せるのは管理者・承認者です');
        if (f.status !== 'pending') throw invalidArg('承認待ちの届出ではありません');
        if (f.requestedBy === auth.uid) throw invalidArg('自分が依頼した届出は自分では差し戻せません。取り消すときは差し戻してもらってください');
        patch = { status: 'draft', rejection: { comment: input.comment || '理由の記入なし', by: auth.uid, at: now } };
        break;
      case 'cancel':
        if (!operator) throw invalidArg('取り消せるのは管理者・担当者です');
        if (f.status !== 'draft') throw invalidArg('下書き（差し戻しを含む）の届出だけ取り消せます');
        patch = { status: 'cancelled', cancelledBy: auth.uid, cancelledAt: now };
        break;
      case 'mockSubmit': {
        if (!operator) throw invalidArg('提出できるのは管理者・担当者です');
        if (f.status !== 'approved') throw invalidArg('承認された届出だけ提出できます');
        const errors = mockErrors(f);
        if (errors.length) return { mockErrors: errors };
        const d = now.toDate();
        const acceptanceNumber = `MOCK-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
        patch = { status: 'submitted', submission: { method: 'mock', date: toDateString(now)!, acceptanceNumber, by: auth.uid, at: now } };
        break;
      }
      case 'paperSubmit':
        if (!operator) throw invalidArg('提出を記録できるのは管理者・担当者です');
        if (f.status !== 'approved') throw invalidArg('承認された届出だけ提出できます');
        if (!input.date) throw invalidArg('提出した日を入れてください');
        patch = { status: 'submitted', submission: { method: 'paper', date: input.date, acceptanceNumber: null, by: auth.uid, at: now } };
        break;
    }
    tx.update(ref, { ...patch, updatedAt: now, version: f.version + 1 });
    // 保存原本：承認時点の記入内容と様式の版。追記するだけで消さない
    if (input.action === 'approve') tx.set(ref.collection('archives').doc(), { ...buildArchive({ source: 'santei', data: f, approvedBy: auth.uid }), approvedAt: now });
    tx.set(db.collection(`${base(auth.companyId)}/auditLogs`).doc(), {
      entity: 'santeiFiling', entityId: input.filingId, action: 'update', changes: { status: { from: f.status, to: patch.status ?? f.status } },
      note: input.comment ?? null, performedBy: auth.uid, performedAt: now, version: f.version + 1,
    });
    return { status: (patch.status ?? f.status) as string, persons: (f.employeeIds ?? []).length as number, number: f.number as number, filingType: f.filingType as string };
  });
  if ('mockErrors' in result) return { success: false, mockErrors: result.mockErrors };

  if (input.action === 'requestApproval' || input.action === 'approve' || input.action === 'reject') {
    const { notify } = await import('../utils/notify');
    const name = result.filingType === 'correction' ? '算定基礎届の訂正届' : result.filingType === 'cancellation' ? '算定基礎届の取消届' : '算定基礎届';
    await notify({
      companyId: auth.companyId, category: 'filing', targetType: 'santeiRun', targetId: runRef.id, createdBy: auth.uid, officeId: input.officeId,
      title: input.action === 'requestApproval' ? `${name}：届出の承認の依頼` : input.action === 'approve' ? `${name}が承認されました` : `${name}が差し戻されました`,
      body: `${input.year}年の算定基礎届（${result.number}件目・${result.persons}名）${input.action === 'reject' ? `：${input.comment || '理由の記入なし'}` : ''}`,
    });
  }
  return { success: true, status: result.status };
}

/** 届出の中身（PDF・画面表示用） */
export async function getSanteiFiling(input: SanteiFilingGetInput, auth: AuthContext) {
  const { runRef } = await loadRun(input, auth);
  const snap = await runRef.collection('filings').doc(input.filingId).get();
  if (!snap.exists) throw notFound('届出');
  const f = snap.data()!;
  return {
    ...filingSummary(snap, auth), header: f.header, persons: f.persons as SanteiFilingPerson[],
    originalPersons: (f.originalPersons ?? null) as SanteiFilingPerson[] | null, corrections: f.corrections ?? [],
  };
}
