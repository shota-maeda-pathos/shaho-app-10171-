// 賞与（一括型）。事業所×支給月ごとに、賞与を登録する → 賞与額の承認 → 保険料の計算と承認 → 賞与支払届の作成・承認・提出
import { filingContentHash } from '../utils/hash';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from '../config';
import { AuthContext, requireOffice } from '../middleware/auth';
import { EmployeeDoc, EmploymentDoc, OfficeDoc } from '../types/firestore';
import { invalidArg, notFound } from '../utils/errors';
import { mapConcurrent } from '../utils/parallel';
import { normalizeEmployment, qualificationDates, toDateString } from '../utils/employment';
import { isPensionExcluded } from '../utils/age';
import { lastDayOfMonth } from '../insurance/calculator';
import { calculateBonusInsurance } from '../insurance/bonus-insurance-calculate/service';
import { createApprovalRequest } from '../approvals/approval-request-create/service';
import { approveApprovalRequest } from '../approvals/approval-request-approve/service';
import { periodTarget } from '../operations/service';
import { authOf, getAllChunked } from '../monthly/service';
import { splitCsvLine } from '../monthly/rules';
import {
  BonusCaps, BonusFilingPerson, BonusPayment, BonusTarget, bonusCaps, bonusFilingDeadline, bonusFilingPerson, bonusTarget, capWarnings,
  commonPaymentDate, earlierMonthsInFiscalYear, isScheduledMonth, nonPaymentChangeOf, parseBonusCsv, paymentCountWarning, paymentErrors, summarizePayments,
} from './bonus-calc';
import {
  BonusAction, BonusEntryInput, BonusFilingGetInput, BonusFilingUpdateInput, BonusHoldInput, BonusImportInput, BonusJobGetInput,
  BonusJobStartInput, BonusNonPaymentFilingInput, BonusNonPaymentInput, BonusRunInput,
} from './schema';

/** 1つの事業所で扱える人数の上限（毎月の処理と同じ） */
export const MAX_BONUS_TARGETS = 3000;
/** 1件の届出に載せる人数の上限（文書の大きさの上限のため） */
const MAX_FILING_PERSONS = 1000;
const CHUNK_SIZE = 25;
const STALE_MS = 10 * 60_000;

const base = (companyId: string) => `companies/${companyId}`;
export const bonusRunId = (officeId: string, payMonth: string) => `${officeId}_${payMonth}`;
const nameOf = (e: FirebaseFirestore.DocumentData) => `${e.lastName ?? ''} ${e.firstName ?? ''}`.trim();
const iso = (v: unknown) => (v as Timestamp | undefined)?.toDate?.().toISOString() ?? null;
const todayInTokyo = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

async function loadRun(input: BonusRunInput, auth: AuthContext) {
  requireOffice(auth, input.officeId);
  const office = await db.doc(`${base(auth.companyId)}/offices/${input.officeId}`).get();
  if (!office.exists) throw notFound('事業所');
  const runRef = db.doc(`${base(auth.companyId)}/bonusRuns/${bonusRunId(input.officeId, input.payMonth)}`);
  return { office: office.data() as OfficeDoc, runRef };
}

/** 保存された賞与の支給の一覧（旧い1件だけの登録は、支給日なしの1回として読む） */
function paymentsOf(d: FirebaseFirestore.DocumentData): BonusPayment[] {
  if (Array.isArray(d.payments)) return d.payments as BonusPayment[];
  return [{ date: d.paymentDate ?? '', cash: Number(d.totalAmount ?? 0), inKind: 0 }];
}

/** 同じ年度の前の月の賞与（年度累計と支給回数）。未承認の月があれば知らせる */
async function earlierBonuses(companyId: string, employeeId: string, payMonth: string) {
  const months = earlierMonthsInFiscalYear(payMonth);
  const snaps = months.length ? await getAllChunked(months.map(ym => db.doc(`${base(companyId)}/employees/${employeeId}/bonuses/${ym}`))) : [];
  let cumulative = 0;
  let count = 0;
  const unconfirmed: string[] = [];
  for (const s of snaps) {
    if (!s.exists) continue;
    const d = s.data()!;
    cumulative += Number(d.standardBonusAmount ?? 0);
    count += paymentsOf(d).length;
    if (d.isConfirmed !== true) unconfirmed.push(s.id);
  }
  return { cumulative, count, unconfirmed };
}

export interface BonusRow {
  employeeId: string;
  employeeNumber: string;
  name: string;
  /** 支給月に在籍している */
  inPeriod: boolean;
  bonus: null | {
    payments: BonusPayment[]; cash: number; inKind: number; total: number; standard: number; firstPaymentDate: string | null; combined: boolean;
    confirmed: boolean; pending: boolean; version: number;
  };
  /** 保険料と届出の要否（賞与があるときだけ） */
  target: BonusTarget | null;
  targetReason: string;
  caps: BonusCaps | null;
  premium: null | {
    employee: number; employer: number; healthCapped: number; pensionCapped: number; exempted: boolean;
    confirmed: boolean; pending: boolean; version: number;
  };
  /** 計算した後に賞与額や年度累計が変わった（承認前なら計算し直す） */
  stale: boolean;
  age70: boolean;
  /** 計算・申請ができない理由 */
  issues: string[];
  /** 止める必要はないが確認したほうがよいこと（上限・年4回以上など） */
  warnings: string[];
  hold: null | { reason: string };
  rejected: { bonus: string | null; premium: string | null };
  /** 載っている届出（取り消したものは除く） */
  filingId: string | null;
}

export interface BonusFilingSummary {
  id: string;
  number: number;
  status: 'draft' | 'pending' | 'approved' | 'submitted' | 'cancelled';
  personCount: number;
  deadline: string | null;
  requestedBy: string | null;
  requestedAt: string | null;
  mine: boolean;
  rejection: string | null;
  submission: { method: 'mock' | 'paper'; date: string; acceptanceNumber: string | null } | null;
  /** 模擬電子申請の状態（送信中・送信エラー・返戻など。届出の画面の提出の部品が詳しく出す） */
  mockStatus: string | null;
  /** bonusPayment（賞与支払届）／bonusNonPayment（賞与不支給報告書） */
  filingType: string;
  /** 賞与不支給報告書の③ 支給予定月の変更（変更しないときは null） */
  change: { before: number[]; after: number[]; noMoreBonus: boolean } | null;
  version: number;
  createdAt: string | null;
}

function filingSummary(d: FirebaseFirestore.DocumentSnapshot, auth: AuthContext): BonusFilingSummary {
  const f = d.data()!;
  return {
    id: d.id, number: f.number, status: f.status, personCount: (f.employeeIds ?? []).length, deadline: f.deadline ?? null,
    requestedBy: f.requestedBy ?? null, requestedAt: iso(f.requestedAt), mine: f.requestedBy === auth.uid,
    rejection: f.rejection?.comment ?? null,
    submission: f.submission ? { method: f.submission.method, date: f.submission.date, acceptanceNumber: f.submission.acceptanceNumber ?? null } : null,
    mockStatus: f.mock?.status ?? null,
    filingType: f.filingType ?? 'bonusPayment',
    change: f.filingType === 'bonusNonPayment' && Array.isArray(f.header?.['変更後の支払予定月'])
      ? { before: f.header['変更前の支払予定月'] ?? [], after: f.header['変更後の支払予定月'], noMoreBonus: !!f.header['今後は支給しない'] } : null,
    version: f.version, createdAt: iso(f.createdAt),
  };
}

const rejectionOf = (d: FirebaseFirestore.DocumentData | undefined) =>
  d?.lastRejection && !d.isConfirmed && !d.approvalPending ? String(d.lastRejection.comment || '理由の記入なし') : null;

/** 1人分の状況。賞与がある人だけ、年度累計・資格・適用を調べる */
async function buildRow(companyId: string, payMonth: string, doc: FirebaseFirestore.DocumentSnapshot,
  b: FirebaseFirestore.DocumentData | undefined, p: FirebaseFirestore.DocumentData | undefined, h: FirebaseFirestore.DocumentData | undefined,
  filingId: string | null): Promise<BonusRow> {
  const employee = doc.data() as EmployeeDoc;
  const row: BonusRow = {
    employeeId: doc.id, employeeNumber: employee.employeeNumber ?? '', name: nameOf(employee), inPeriod: periodTarget(employee, payMonth),
    bonus: null, target: null, targetReason: '', caps: null, premium: null, stale: false,
    age70: !!employee.birthDate && isPensionExcluded(employee.birthDate, payMonth),
    issues: [], warnings: [], hold: h?.reason ? { reason: h.reason } : null, rejected: { bonus: rejectionOf(b), premium: rejectionOf(p) }, filingId,
  };
  if (!b) return row;
  const s = summarizePayments(paymentsOf(b));
  row.bonus = {
    payments: s.payments, cash: s.cash, inKind: s.inKind, total: s.total, standard: s.standard, firstPaymentDate: s.firstPaymentDate, combined: s.combined,
    confirmed: b.isConfirmed === true, pending: b.approvalPending === true, version: b.version ?? 0,
  };
  const empPath = `${base(companyId)}/employees/${doc.id}`;
  const [earlier, employmentSnap] = await Promise.all([
    earlierBonuses(companyId, doc.id, payMonth),
    db.collection(`${empPath}/employments`).where('effectiveDate', '<=', lastDayOfMonth(payMonth)).orderBy('effectiveDate', 'desc').limit(1).get(),
  ]);
  const employment = employmentSnap.empty ? null : normalizeEmployment(employmentSnap.docs[0].data() as EmploymentDoc);
  const { acquisitionDate, lossDate } = qualificationDates(employee);
  const t = bonusTarget({
    yearMonth: payMonth, firstPaymentDate: s.firstPaymentDate, acquisitionDate, lossDate,
    enrolled: employment === null || employment.healthInsuranceEnrolled || employment.pensionEnrolled,
  });
  row.target = t.target;
  row.targetReason = t.reason;
  row.caps = bonusCaps(s.standard, earlier.cumulative);
  if (t.target !== 'excluded') {
    row.warnings.push(...capWarnings(row.caps));
    if (t.target === 'lossMonth') row.warnings.push(t.reason);
    if (row.age70) row.warnings.push('70歳以上のため厚生年金の保険料はかかりません（届出は70歳以上被用者として出します）');
    if (!employee.birthDate) row.issues.push('生年月日が未入力');
    if (earlier.unconfirmed.length) row.issues.push(`同じ年度の前の月（${earlier.unconfirmed.join('・')}）に未承認の賞与があります。年度累計を数えるため、先に承認してください`);
  }
  if (s.payments.some(x => !x.date)) row.issues.push('支給日が登録されていません（賞与を登録し直してください）');
  const countWarning = paymentCountWarning(earlier.count, s.payments.length);
  if (countWarning) row.warnings.push(countWarning);
  if (s.combined) row.warnings.push(`同じ月に${s.payments.length}回支給しています。合算して計算し、届出には初回の支給日を書きます`);
  if (p) {
    row.premium = {
      employee: p.totalEmployeeAmount ?? 0, employer: p.totalEmployerAmount ?? 0, healthCapped: p.healthCappedAmount ?? 0, pensionCapped: p.pensionCappedAmount ?? 0,
      exempted: p.isExempted === true, confirmed: p.isConfirmed === true, pending: p.approvalPending === true, version: p.version ?? 0,
    };
    if (p.isExempted) row.warnings.push('産休・育休のため保険料は免除です（届出は出します）');
    if (!p.isConfirmed && !p.approvalPending) {
      if (p.bonusVersion !== b.version) row.stale = true;
      else if (typeof p.priorCumulativeBonusAmount === 'number' && p.priorCumulativeBonusAmount !== earlier.cumulative) row.stale = true;
      if (row.stale) row.warnings.push('計算した後に賞与額または年度累計が変わりました。計算し直してください');
    }
  }
  return row;
}

/** 事業所と支給月の状況（全員分）。判定はすべてサーバーで行う */
export async function bonusOverview(input: BonusRunInput, auth: AuthContext) {
  const { office, runRef } = await loadRun(input, auth);
  const companyBase = base(auth.companyId);
  const employeesSnap = await db.collection(`${companyBase}/employees`)
    .where('officeId', '==', input.officeId).where('deletedAt', '==', null)
    .orderBy('employeeNumber', 'asc').limit(MAX_BONUS_TARGETS + 1).get();
  if (employeesSnap.size > MAX_BONUS_TARGETS) throw invalidArg(`この事業所の従業員が${MAX_BONUS_TARGETS}名を超えています。事業所を分けて処理してください`);

  const refs = employeesSnap.docs.flatMap(d => {
    const e = `${companyBase}/employees/${d.id}`;
    return [db.doc(`${e}/bonuses/${input.payMonth}`), db.doc(`${e}/bonusInsurance/${input.payMonth}`), db.doc(`${runRef.path}/holds/${d.id}`)];
  });
  const [snaps, run, filings] = await Promise.all([getAllChunked(refs), runRef.get(), runRef.collection('filings').orderBy('number', 'asc').get()]);
  const filingOf = new Map<string, string>();
  for (const f of filings.docs) {
    if (f.data().status === 'cancelled') continue;
    for (const id of f.data().employeeIds ?? []) filingOf.set(id, f.id);
  }
  // 在籍している人と、賞与が登録されている人を出す
  const listed = employeesSnap.docs.map((d, i) => ({ d, i })).filter(({ d, i }) => periodTarget(d.data(), input.payMonth) || snaps[i * 3].exists);
  const rows = await mapConcurrent(listed, 20, ({ d, i }) =>
    buildRow(auth.companyId, input.payMonth, d, snaps[i * 3].data(), snaps[i * 3 + 1].data(), snaps[i * 3 + 2].data(), filingOf.get(d.id) ?? null));

  const runData = run.data() ?? {};
  const paid = rows.filter(r => r.bonus);
  const firstDates = paid.map(r => r.bonus!.firstPaymentDate).filter((x): x is string => !!x).sort();
  const sum = (f: (r: BonusRow) => number) => rows.reduce((a, r) => a + f(r), 0);
  const review = (key: 'bonusReview' | 'premiumReview') => runData[key]
    ? { requestedBy: runData[key].requestedBy, requestedAt: iso(runData[key].requestedAt), mine: runData[key].requestedBy === auth.uid } : null;
  return {
    office: { id: input.officeId, name: office.name ?? '', bonusMonths: office.bonusMonths ?? [] },
    payMonth: input.payMonth,
    /** 事業所の賞与支給予定月か */
    scheduled: isScheduledMonth(office.bonusMonths, input.payMonth),
    monthEnded: todayInTokyo() > lastDayOfMonth(input.payMonth),
    nonPayment: runData.nonPayment ? { reportedOn: runData.nonPayment.reportedOn as string, by: runData.nonPayment.by as string, filingId: (runData.nonPayment.filingId as string | undefined) ?? null } : null,
    /** 届出の期限（いちばん早い支給日から5日） */
    deadline: firstDates.length ? bonusFilingDeadline(firstDates[0]) : null,
    totals: {
      paidCount: paid.length, total: sum(r => r.bonus?.total ?? 0), standard: sum(r => r.bonus?.standard ?? 0),
      employee: sum(r => r.premium?.employee ?? 0), employer: sum(r => r.premium?.employer ?? 0),
    },
    reviews: { bonus: review('bonusReview'), premium: review('premiumReview') },
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
  return employee.data()!;
}

export async function setBonusHold(input: BonusHoldInput, auth: AuthContext) {
  const { runRef } = await loadRun(input, auth);
  const ref = runRef.collection('holds').doc(input.employeeId);
  await db.runTransaction(async tx => {
    await requireEmployeeInOffice(tx, auth.companyId, input.employeeId, input.officeId);
    const current = await tx.get(ref);
    const now = Timestamp.now();
    if (input.reason) tx.set(ref, { reason: input.reason, updatedBy: auth.uid, updatedAt: now });
    else tx.delete(ref);
    tx.set(runRef, { officeId: input.officeId, payMonth: input.payMonth, updatedAt: now }, { merge: true });
    tx.set(db.collection(`${base(auth.companyId)}/auditLogs`).doc(), {
      entity: 'bonusRun', entityId: runRef.id, employeeId: input.employeeId, action: 'update',
      changes: { hold: { from: current.data()?.reason ?? null, to: input.reason } }, performedBy: auth.uid, performedAt: now,
    });
  });
  return { success: true };
}

/** 不支給報告書を出した日を記録する（支給予定月に賞与を払わなかったとき） */
export async function setBonusNonPayment(input: BonusNonPaymentInput, auth: AuthContext) {
  const { runRef } = await loadRun(input, auth);
  const now = Timestamp.now();
  await runRef.set({
    officeId: input.officeId, payMonth: input.payMonth, updatedAt: now,
    nonPayment: input.reportedOn ? { reportedOn: input.reportedOn, by: auth.uid, at: now } : FieldValue.delete(),
  }, { merge: true });
  await db.collection(`${base(auth.companyId)}/auditLogs`).add({
    entity: 'bonusRun', entityId: runRef.id, action: 'update', changes: { nonPayment: { from: null, to: input.reportedOn } }, performedBy: auth.uid, performedAt: now,
  });
  return { success: true };
}

/**
 * 賞与不支給報告書を作る（支給予定月に賞与を払わなかったとき）。承認・提出は賞与支払届と同じ流れ（届出の承認→提出）。
 * 提出を終えると、不支給の記録と、③で変えた支給予定月を事業所に反映する
 */
export async function createBonusNonPaymentFiling(input: BonusNonPaymentFilingInput, auth: AuthContext) {
  const { office, runRef } = await loadRun(input, auth);
  if (!isScheduledMonth(office.bonusMonths, input.payMonth)) throw invalidArg('この月は事業所の賞与支給予定月ではありません（設定の事業所一覧で支給予定月を確かめてください）');
  const { errors, before, after, noMoreBonus } = nonPaymentChangeOf(input.change, office.bonusMonths);
  if (errors.length) throw invalidArg(errors.join('。'));
  const overview = await bonusOverview({ companyId: input.companyId, officeId: input.officeId, payMonth: input.payMonth }, auth);
  if (overview.rows.some(r => r.bonus)) throw invalidArg('この月は賞与が登録されています。賞与を払った月は賞与支払届を出します');
  const companyBase = base(auth.companyId);
  const company = await db.doc(companyBase).get();
  const header = {
    '事業所整理記号': office.officeNumber ?? '', '事業所番号': office.officeCode ?? '', '郵便番号': office.postalCode ?? '',
    '事業所所在地': office.address ?? '', '事業所名称': office.name ?? '', '電話番号': office.phone ?? '',
    '事業主氏名': company.data()?.representativeName ?? '', '会社名': company.data()?.name ?? '',
    '届出年月日': input.reportDate, '賞与支払年月': input.payMonth, '支給の状況': '不支給',
    '変更前の支払予定月': after === null ? null : before, '変更後の支払予定月': after, '今後は支給しない': noMoreBonus,
  };
  const id = await db.runTransaction(async tx => {
    const run = await tx.get(runRef);
    const active = await tx.get(runRef.collection('filings').where('status', 'in', ['draft', 'pending', 'approved', 'submitted']));
    if (active.docs.some(d => d.data().filingType === 'bonusNonPayment')) throw invalidArg('この月の賞与不支給報告書はもう作ってあります（作り直すときは取り消してから作ります）');
    if (active.docs.some(d => (d.data().filingType ?? 'bonusPayment') === 'bonusPayment')) throw invalidArg('この月は賞与支払届があります');
    const number = ((run.data()?.filingCount ?? 0) as number) + 1;
    const now = Timestamp.now();
    const ref = runRef.collection('filings').doc();
    tx.set(ref, {
      number, officeId: input.officeId, payMonth: input.payMonth, filingType: 'bonusNonPayment', status: 'draft', deadline: null,
      employeeIds: [], header, persons: [],
      requestedBy: null, requestedAt: null, approvedBy: null, approvedAt: null, rejection: null, submission: null,
      createdBy: auth.uid, createdAt: now, updatedAt: now, version: 1,
    });
    tx.set(runRef, { officeId: input.officeId, payMonth: input.payMonth, filingCount: number, updatedAt: now }, { merge: true });
    tx.set(db.collection(`${companyBase}/auditLogs`).doc(), {
      entity: 'bonusFiling', entityId: ref.id, action: 'create', changes: { filingType: { from: null, to: 'bonusNonPayment' } },
      performedBy: auth.uid, performedAt: now, version: 1,
    });
    return ref.id;
  });
  return { filingId: id };
}

/**
 * 提出の処理（模擬電子申請の完了・紙の提出）のあとに呼ぶ。賞与不支給報告書を提出し終えたら、
 * run に不支給の記録を書き、③で変えた支給予定月を事業所に反映する（一度だけ）
 */
export async function afterBonusFilingSubmitted(path: string) {
  const ref = db.doc(path);
  const runRef = ref.parent.parent!;
  const companyId = path.split('/')[1];
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const f = snap.data();
    if (!f || f.filingType !== 'bonusNonPayment' || f.status !== 'submitted' || f.nonPaymentApplied) return;
    const officeRef = db.doc(`companies/${companyId}/offices/${f.officeId}`);
    const office = await tx.get(officeRef);
    const now = Timestamp.now();
    const reportedOn = (f.submission?.date as string | undefined) ?? toDateString(now)!;
    tx.set(runRef, { nonPayment: { reportedOn, by: f.requestedBy ?? 'system', at: now, filingId: snap.id }, updatedAt: now }, { merge: true });
    const after = f.header?.['変更後の支払予定月'] as number[] | null | undefined;
    if (Array.isArray(after) && office.exists) {
      const version = ((office.data()!.version as number | undefined) ?? 0) + 1;
      tx.update(officeRef, { bonusMonths: after, updatedAt: now, version });
      tx.set(db.collection(`companies/${companyId}/auditLogs`).doc(), {
        entity: 'office', entityId: f.officeId, action: 'update', changes: { bonusMonths: { from: office.data()!.bonusMonths ?? [], to: after } },
        note: '賞与不支給報告書の提出で支給予定月を変更', performedBy: 'system', performedAt: now, version,
      });
    }
    tx.update(ref, { nonPaymentApplied: true });
  });
}

// ---- 賞与の登録 ----

/** 保存する賞与の文書。標準賞与額は合算額の千円未満切り捨て、年度累計は保存時点の参考値（保険料の計算ではサーバーが数え直す） */
function bonusData(officeId: string, payMonth: string, payments: BonusPayment[], priorCumulative: number, source: 'csv' | 'manual') {
  const s = summarizePayments(payments);
  return {
    yearMonth: payMonth, officeId, payments: s.payments, paymentDate: s.firstPaymentDate,
    cashAmount: s.cash, inKindAmount: s.inKind, totalAmount: s.total, standardBonusAmount: s.standard,
    cumulativeBonusAmount: priorCumulative + s.standard, source,
  };
}

/** 賞与CSVの確認（dryRun）と取込。CSVに載った人は、その月の支給をCSVの内容で置き換える */
export async function importBonus(input: BonusImportInput, auth: AuthContext) {
  await loadRun(input, auth);
  const companyBase = base(auth.companyId);
  const parsed = parseBonusCsv(input.csv, input.payMonth, splitCsvLine);
  const errors = [...parsed.errors];
  const employees = await db.collection(`${companyBase}/employees`).where('officeId', '==', input.officeId).where('deletedAt', '==', null).get();
  const byNumber = new Map(employees.docs.map(d => [String(d.data().employeeNumber ?? ''), d]));
  const valid = parsed.rows.filter(row => {
    const doc = byNumber.get(row.employeeNumber);
    const fail = (message: string) => { for (const line of row.lines) errors.push({ line, employeeNumber: row.employeeNumber, message }); return false; };
    if (!doc) return fail('この事業所に、この社員番号の従業員がいません');
    if (!periodTarget(doc.data(), input.payMonth)) return fail(`${input.payMonth}に在籍していません`);
    return true;
  });
  const existing = await getAllChunked(valid.map(row => db.doc(`${companyBase}/employees/${byNumber.get(row.employeeNumber)!.id}/bonuses/${input.payMonth}`)));
  const planned = valid.flatMap((row, i) => {
    const d = existing[i].data();
    if (d?.isConfirmed || d?.approvalPending) {
      for (const line of row.lines) errors.push({ line, employeeNumber: row.employeeNumber, message: d.isConfirmed ? '承認済みの賞与は上書きできません（差し戻してから取り込んでください）' : '承認の依頼中のため上書きできません' });
      return [];
    }
    const employee = byNumber.get(row.employeeNumber)!;
    return [{ row, employeeId: employee.id, name: nameOf(employee.data()), overwrite: existing[i].exists, version: d?.version ?? 0 }];
  });
  const plan = await mapConcurrent(planned, 20, async p => {
    const earlier = await earlierBonuses(auth.companyId, p.employeeId, input.payMonth);
    const s = summarizePayments(p.row.payments);
    const warnings = [...capWarnings(bonusCaps(s.standard, earlier.cumulative))];
    const countWarning = paymentCountWarning(earlier.count, s.payments.length);
    if (countWarning) warnings.push(countWarning);
    return { ...p, prior: earlier.cumulative, summary: s, warnings };
  });
  errors.sort((a, b) => a.line - b.line);
  const preview = plan.map(p => ({
    line: p.row.lines[0], employeeNumber: p.row.employeeNumber, name: p.name, payments: p.summary.payments.length,
    total: p.summary.total, standard: p.summary.standard, overwrite: p.overwrite, warnings: p.warnings,
  }));
  if (input.dryRun) return { dryRun: true, rows: preview, errors, imported: 0 };

  for (let i = 0; i < plan.length; i += 20) {
    const part = plan.slice(i, i + 20);
    await db.runTransaction(async tx => {
      const refs = part.map(p => db.doc(`${companyBase}/employees/${p.employeeId}/bonuses/${input.payMonth}`));
      const current = await Promise.all(refs.map(ref => tx.get(ref)));
      const now = Timestamp.now();
      part.forEach((p, k) => {
        const d = current[k].data();
        if ((d?.version ?? 0) !== p.version || d?.isConfirmed || d?.approvalPending) throw invalidArg(`${p.row.employeeNumber}の賞与が取込中に変更されました。もう一度確認してください`);
        const version = (d?.version ?? 0) + 1;
        tx.set(refs[k], {
          ...bonusData(input.officeId, input.payMonth, p.row.payments, p.prior, 'csv'),
          isConfirmed: false, approvalPending: false, confirmedAt: null, confirmedBy: null, version, createdAt: d?.createdAt ?? now, updatedAt: now,
        });
        tx.set(db.collection(`${companyBase}/auditLogs`).doc(), {
          entity: 'bonus', entityId: `${p.employeeId}/${input.payMonth}`, action: d ? 'update' : 'create',
          changes: { source: { from: null, to: 'bonusCsvImport' } }, performedBy: auth.uid, performedAt: now, version,
        });
      });
    });
  }
  if (plan.length) await db.doc(`${companyBase}/bonusRuns/${bonusRunId(input.officeId, input.payMonth)}`).set({ officeId: input.officeId, payMonth: input.payMonth, updatedAt: Timestamp.now() }, { merge: true });
  return { dryRun: false, rows: preview, errors, imported: plan.length };
}

/** 1人分の賞与を入力する（その月の支給をすべて。2回目の支給はここで足す）。空にすると登録を消す */
export async function saveBonusEntry(input: BonusEntryInput, auth: AuthContext) {
  const { runRef } = await loadRun(input, auth);
  if (input.payments.length) {
    const errors = paymentErrors(input.payMonth, input.payments);
    if (errors.length) throw invalidArg(errors.join('。'));
  }
  const empPath = `${base(auth.companyId)}/employees/${input.employeeId}`;
  const earlier = await earlierBonuses(auth.companyId, input.employeeId, input.payMonth);
  const result = await db.runTransaction(async tx => {
    const employee = await requireEmployeeInOffice(tx, auth.companyId, input.employeeId, input.officeId);
    if (input.payments.length && !periodTarget(employee, input.payMonth)) throw invalidArg(`${input.payMonth}に在籍していません`);
    const ref = db.doc(`${empPath}/bonuses/${input.payMonth}`);
    const premiumRef = db.doc(`${empPath}/bonusInsurance/${input.payMonth}`);
    const [current, premium] = await Promise.all([tx.get(ref), tx.get(premiumRef)]);
    const d = current.data();
    if ((d?.version ?? 0) !== input.expectedVersion) throw invalidArg('賞与が更新されています。画面を読み込み直してください');
    if (d?.isConfirmed || d?.approvalPending) throw invalidArg(d.isConfirmed ? '承認済みの賞与は変更できません（差し戻してから直してください）' : '承認の依頼中のため変更できません');
    const now = Timestamp.now();
    if (!input.payments.length) {
      if (!current.exists) return { version: 0 };
      if (premium.exists && (premium.data()!.isConfirmed || premium.data()!.approvalPending)) throw invalidArg('保険料が承認済み・承認待ちのため消せません');
      tx.delete(ref);
      if (premium.exists) tx.delete(premiumRef);
      tx.set(db.collection(`${base(auth.companyId)}/auditLogs`).doc(), {
        entity: 'bonus', entityId: `${input.employeeId}/${input.payMonth}`, action: 'delete', changes: {}, performedBy: auth.uid, performedAt: now,
      });
      return { version: 0 };
    }
    const version = (d?.version ?? 0) + 1;
    tx.set(ref, {
      ...bonusData(input.officeId, input.payMonth, input.payments, earlier.cumulative, 'manual'),
      isConfirmed: false, approvalPending: false, confirmedAt: null, confirmedBy: null, version, createdAt: d?.createdAt ?? now, updatedAt: now,
      ...(d?.lastRejection ? { lastRejection: d.lastRejection } : {}),
    });
    tx.set(runRef, { officeId: input.officeId, payMonth: input.payMonth, updatedAt: now }, { merge: true });
    tx.set(db.collection(`${base(auth.companyId)}/auditLogs`).doc(), {
      entity: 'bonus', entityId: `${input.employeeId}/${input.payMonth}`, action: d ? 'update' : 'create',
      changes: { payments: { from: d?.payments ?? null, to: input.payments } }, performedBy: auth.uid, performedAt: now, version,
    });
    return { version };
  });
  const s = summarizePayments(input.payments);
  const warnings = input.payments.length ? capWarnings(bonusCaps(s.standard, earlier.cumulative)) : [];
  const countWarning = input.payments.length ? paymentCountWarning(earlier.count, input.payments.length) : null;
  if (countWarning) warnings.push(countWarning);
  return { success: true, version: result.version, warnings };
}

// ---- 一括処理（バックグラウンド） ----

const ACTION_LABEL: Record<BonusAction, string> = {
  requestBonusApproval: '賞与額の承認の依頼', approveBonus: '賞与額の承認', calculate: '保険料の計算',
  requestPremiumApproval: '保険料の承認の依頼', approvePremium: '保険料の承認',
};
const APPROVE_ACTIONS: BonusAction[] = ['approveBonus', 'approvePremium'];

export async function startBonusJob(input: BonusJobStartInput, auth: AuthContext) {
  const { runRef } = await loadRun(input, auth);
  if (APPROVE_ACTIONS.includes(input.action) && !auth.roles.some(r => r === 'admin' || r === 'approver')) throw invalidArg('承認できるのは管理者・承認者です');
  const ids = [...new Set(input.employeeIds)];
  const jobRef = db.collection(`${base(auth.companyId)}/bonusJobs`).doc();
  await db.runTransaction(async tx => {
    const run = await tx.get(runRef);
    const latest = run.data()?.latestJobId as string | undefined;
    if (latest) {
      const j = (await tx.get(db.doc(`${base(auth.companyId)}/bonusJobs/${latest}`))).data();
      if (j && j.status === 'running' && j.createdAt.toMillis() > Date.now() - STALE_MS) throw invalidArg('前の処理がまだ終わっていません。終わってから実行してください');
    }
    const now = Timestamp.now();
    const review = input.action === 'requestBonusApproval' ? { bonusReview: { requestedBy: auth.uid, requestedAt: now } }
      : input.action === 'requestPremiumApproval' ? { premiumReview: { requestedBy: auth.uid, requestedAt: now } } : {};
    tx.set(runRef, { officeId: input.officeId, payMonth: input.payMonth, latestJobId: jobRef.id, updatedAt: now, ...review }, { merge: true });
    tx.set(jobRef, {
      runId: runRef.id, officeId: input.officeId, payMonth: input.payMonth, action: input.action,
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
  const job = await db.doc(`${base(companyId)}/bonusJobs/${jobId}`).get();
  if (!job.exists) return null;
  const j = job.data()!;
  const stalled = j.status === 'running' && j.createdAt.toMillis() < Date.now() - STALE_MS;
  return {
    id: job.id, action: j.action as BonusAction, label: ACTION_LABEL[j.action as BonusAction] ?? j.action,
    total: j.total, processed: j.processed, succeeded: j.succeeded, failed: j.failed,
    status: stalled ? 'stalled' : j.status as 'running' | 'completed', createdAt: iso(j.createdAt), completedAt: iso(j.completedAt),
  };
}

export async function getBonusJob(input: BonusJobGetInput, auth: AuthContext) {
  const { runRef } = await loadRun(input, auth);
  const job = await db.doc(`${base(auth.companyId)}/bonusJobs/${input.jobId}`).get();
  if (!job.exists || job.data()!.runId !== runRef.id) throw notFound('一括処理');
  const failures = await db.collection(`${job.ref.path}/failures`).limit(MAX_BONUS_TARGETS).get();
  return {
    job: await jobSummary(auth.companyId, input.jobId),
    failures: failures.docs.map(d => ({ employeeId: d.id, message: d.data().message as string })),
  };
}

/** 1人分の処理。成功なら何も返さず、失敗なら例外。申請・承認の直前に今のデータで判定し直す */
async function processOne(action: BonusAction, employeeId: string, job: FirebaseFirestore.DocumentData, auth: AuthContext): Promise<void> {
  const companyBase = base(auth.companyId);
  const empPath = `${companyBase}/employees/${employeeId}`;
  const { payMonth, officeId, runId } = job;
  const [employee, hold, bonus, premium] = await getAllChunked([
    db.doc(empPath), db.doc(`${companyBase}/bonusRuns/${runId}/holds/${employeeId}`),
    db.doc(`${empPath}/bonuses/${payMonth}`), db.doc(`${empPath}/bonusInsurance/${payMonth}`),
  ]);
  if (!employee.exists || employee.data()!.deletedAt != null) throw notFound('従業員');
  if (employee.data()!.officeId !== officeId) throw invalidArg('対象の事業所が一致しません');
  if (hold.data()?.reason) throw invalidArg(`保留中です（${hold.data()!.reason}）`);
  const b = bonus.data();
  const p = premium.data();
  switch (action) {
    case 'requestBonusApproval':
      if (!b) throw invalidArg('賞与が登録されていません');
      if (b.isConfirmed || b.approvalPending) return;
      if (paymentsOf(b).some(x => !x.date)) throw invalidArg('支給日が登録されていません。賞与を登録し直してください');
      await createApprovalRequest({ companyId: auth.companyId, employeeId, requestType: 'bonus', targetPath: bonus.ref.path, targetVersion: b.version }, auth, { notify: false });
      return;
    case 'approveBonus':
      if (!b?.approvalPending) throw invalidArg(b?.isConfirmed ? '承認済みです' : '承認の依頼がありません');
      await approveApprovalRequest({ companyId: auth.companyId, employeeId, requestId: `bonus-${payMonth}-v${b.version}` }, auth, { notify: false });
      return;
    case 'calculate': {
      if (p?.isConfirmed || p?.approvalPending) return;
      await calculateBonusInsurance({ companyId: auth.companyId, employeeId, yearMonth: payMonth }, auth);
      return;
    }
    case 'requestPremiumApproval': {
      if (!p) throw invalidArg('保険料が計算されていません');
      if (p.isConfirmed || p.approvalPending) return;
      // 計算した後に賞与額・年度累計が変わっていれば、計算し直してから依頼する
      const row = await buildRow(auth.companyId, payMonth, employee, b, p, undefined, null);
      if (row.stale) throw invalidArg('計算した後に賞与額または年度累計が変わりました。計算し直してください');
      if (row.issues.length) throw invalidArg(row.issues[0]);
      await createApprovalRequest({ companyId: auth.companyId, employeeId, requestType: 'bonusInsurance', targetPath: premium.ref.path, targetVersion: p.version }, auth, { notify: false });
      return;
    }
    case 'approvePremium': {
      if (!p?.approvalPending) throw invalidArg(p?.isConfirmed ? '承認済みです' : '承認の依頼がありません');
      const row = await buildRow(auth.companyId, payMonth, employee, b, { ...p, approvalPending: false }, undefined, null);
      if (row.stale) throw invalidArg('承認を依頼した後に年度累計が変わりました。差し戻してから計算し直してください');
      await approveApprovalRequest({ companyId: auth.companyId, employeeId, requestId: `bonusInsurance-${payMonth}-v${p.version}` }, auth, { notify: false });
      return;
    }
  }
}

/** chunks の1件を処理する（Firestore のトリガーから呼ぶ） */
export async function processBonusChunk(companyId: string, jobId: string, chunkId: string) {
  const jobRef = db.doc(`${base(companyId)}/bonusJobs/${jobId}`);
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
    const forReviewer = finished.action === 'requestBonusApproval' || finished.action === 'requestPremiumApproval';
    const label = ACTION_LABEL[finished.action as BonusAction];
    await notify({
      companyId, category: forReviewer ? 'approval' : 'system', targetType: 'bonusRun', targetId: finished.runId, createdBy: finished.createdBy,
      title: forReviewer ? `賞与：${label}` : `賞与：${label}が終わりました`,
      body: `${finished.payMonth}支給の賞与 ${finished.total}名中 ${finished.succeeded}名が完了${finished.failed ? `、${finished.failed}名が失敗` : ''}${forReviewer ? '。賞与の画面で確認して承認してください' : ''}`,
    });
  }
}

// ---- 届出 ----

/**
 * 保険料が承認された人をまとめて、賞与支払届を作る（事業所ごとに1件。後から承認された人は追加の届出にする）。
 * 中身は承認された賞与（支給の一覧）から作る。同月に複数回の支給は、初回の支給日と合算額を書く
 */
export async function createBonusFiling(input: BonusRunInput, auth: AuthContext) {
  const { office, runRef } = await loadRun(input, auth);
  const overview = await bonusOverview(input, auth);
  const targets = overview.rows.filter(r => r.premium?.confirmed && r.bonus?.confirmed && r.target !== 'excluded' && !r.hold && !r.filingId);
  if (!targets.length) throw invalidArg('届出に載せる人がいません（保険料が承認された人のうち、まだ届出に載っていない人が対象です）');

  const companyBase = base(auth.companyId);
  const [company, ...employees] = await getAllChunked([db.doc(companyBase), ...targets.map(r => db.doc(`${companyBase}/employees/${r.employeeId}`))]);
  const details: BonusFilingPerson[] = targets.map((r, i) => {
    const e = employees[i].data() as EmployeeDoc;
    return bonusFilingPerson({
      employeeId: r.employeeId, insuredPersonNumber: e.insuredPersonNumber ?? '', name: nameOf(e),
      birthDate: toDateString(e.birthDate) ?? '', age70: r.age70, payments: r.bonus!.payments,
    });
  });
  const firstDates = details.map(p => p.賞与支払年月日).sort();
  const header = {
    '事業所整理記号': office.officeNumber ?? '', '事業所名称': office.name ?? '', '事業所所在地': office.address ?? '',
    '電話番号': office.phone ?? '', '事業主氏名': company.data()?.representativeName ?? '', '会社名': company.data()?.name ?? '',
    '支給月': input.payMonth, '賞与支払年月日': commonPaymentDate(firstDates) ?? '',
  };
  const deadline = bonusFilingDeadline(firstDates[0]);

  const groups: BonusFilingPerson[][] = [];
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
        number, officeId: input.officeId, payMonth: input.payMonth, filingType: 'bonusPayment', status: 'draft', deadline,
        employeeIds: persons.map(p => p.employeeId), header, persons,
        requestedBy: null, requestedAt: null, approvedBy: null, approvedAt: null, rejection: null, submission: null,
        createdBy: auth.uid, createdAt: now, updatedAt: now, version: 1,
      });
      tx.set(db.collection(`${companyBase}/auditLogs`).doc(), {
        entity: 'bonusFiling', entityId: ref.id, action: 'create', changes: { persons: { from: null, to: persons.length } },
        performedBy: auth.uid, performedAt: now, version: 1,
      });
    }
    tx.set(runRef, { officeId: input.officeId, payMonth: input.payMonth, filingCount: number, updatedAt: now }, { merge: true });
    return ids;
  });
  return { filingIds: created, persons: details.length };
}

/** 模擬電子申請で確かめる項目。足りなければ受け付けない */
export function mockErrors(f: FirebaseFirestore.DocumentData): string[] {
  const errors: string[] = [];
  if (!f.header?.['事業所名称']) errors.push('事業所名称が未登録です');
  if (f.filingType === 'bonusNonPayment') {
    if (!f.header?.['事業所整理記号']) errors.push('事業所整理記号が未登録です');
    if (!f.header?.['賞与支払年月']) errors.push('賞与支払年月がありません');
    return errors;
  }
  for (const p of (f.persons ?? []) as BonusFilingPerson[]) {
    if (!p.被保険者氏名) errors.push(`${p.employeeId}：被保険者氏名がありません`);
    if (!p.生年月日) errors.push(`${p.被保険者氏名}：生年月日がありません`);
    if (!p.賞与支払年月日) errors.push(`${p.被保険者氏名}：賞与支払年月日がありません`);
    if (!(p.賞与額_合計 > 0)) errors.push(`${p.被保険者氏名}：賞与額がありません`);
  }
  return errors;
}

/** 届出の承認と提出。承認は依頼した人とは別の管理者・承認者が行う */
export async function updateBonusFiling(input: BonusFilingUpdateInput, auth: AuthContext) {
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
    tx.set(db.collection(`${base(auth.companyId)}/auditLogs`).doc(), {
      entity: 'bonusFiling', entityId: input.filingId, action: 'update', changes: { status: { from: f.status, to: patch.status ?? f.status } },
      note: input.comment ?? null, performedBy: auth.uid, performedAt: now, version: f.version + 1,
    });
    return { status: (patch.status ?? f.status) as string, persons: (f.employeeIds ?? []).length as number, number: f.number as number };
  });
  if ('mockErrors' in result) return { success: false, mockErrors: result.mockErrors };

  if (input.action === 'requestApproval' || input.action === 'approve' || input.action === 'reject') {
    const { notify } = await import('../utils/notify');
    await notify({
      companyId: auth.companyId, category: 'filing', targetType: 'bonusRun', targetId: runRef.id, createdBy: auth.uid,
      title: input.action === 'requestApproval' ? '賞与支払届：届出の承認の依頼' : input.action === 'approve' ? '賞与支払届が承認されました' : '賞与支払届が差し戻されました',
      body: `${input.payMonth}支給の賞与支払届（${result.number}件目・${result.persons}名）${input.action === 'reject' ? `：${input.comment || '理由の記入なし'}` : ''}`,
    });
  }
  return { success: true, status: result.status };
}

/** 届出の中身（PDF・画面表示用） */
export async function getBonusFiling(input: BonusFilingGetInput, auth: AuthContext) {
  const { runRef } = await loadRun(input, auth);
  const snap = await runRef.collection('filings').doc(input.filingId).get();
  if (!snap.exists) throw notFound('届出');
  const f = snap.data()!;
  return { ...filingSummary(snap, auth), header: f.header, persons: f.persons as BonusFilingPerson[] };
}
