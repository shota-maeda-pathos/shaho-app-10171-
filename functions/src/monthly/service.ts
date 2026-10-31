// 毎月の処理（一括型の見本）。給与の取込 → 給与の確認 → 保険料の計算 → 結果の確認 → 明細の公開 → 徴収の記録
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from '../config';
import { AuthContext, Role, requireOffice } from '../middleware/auth';
import { EmployeeDoc, EmploymentDoc, OfficeDoc } from '../types/firestore';
import { invalidArg, notFound } from '../utils/errors';
import { mapConcurrent } from '../utils/parallel';
import { normalizeEmployment, qualificationDates } from '../utils/employment';
import { addMonths, coverageForMonth, lastDayOfMonth } from '../insurance/calculator';
import { calculateMonthlyInsurance } from '../insurance/monthly-insurance-calculate/service';
import { createApprovalRequest } from '../approvals/approval-request-create/service';
import { approveApprovalRequest } from '../approvals/approval-request-approve/service';
import { periodTarget } from '../operations/service';
import { findAllRates, rateFingerprint, rateValuesChanged } from '../utils/insurance-rate';
import { RevisionAlert, revisionAlerts } from '../grade-revision/alerts';
import {
  CollectionPlan, CollectionStatus, DEFAULT_SALARY_ITEMS, DeductionMethod, PremiumFacts, SalaryItem, collectionPlan, collectionStatus, diffReasons,
  parseSalaryCsv, premiumMonthFor, remunerationWarning,
} from './rules';
import {
  CollectionEntryInput, HoldInput, ImportInput, JobGetInput, JobStartInput, MonthlyAction, NoPayInput, RunInput, SalaryItemsInput,
} from './schema';

/** 1回の一括処理で扱える人数の上限 */
export const MAX_JOB_TARGETS = 3000;
/** 1つの処理単位（トリガー1回）で扱う人数 */
const CHUNK_SIZE = 25;
/** 処理が止まったとみなす時間 */
const STALE_MS = 10 * 60_000;

export function runId(officeId: string, payMonth: string) { return `${officeId}_${payMonth}`; }

/** 給与項目マスタ（会社ごと）。未登録なら既定の2項目 */
async function salaryItemsOf(companyId: string): Promise<{ items: SalaryItem[]; version: number }> {
  const d = (await db.doc(`companies/${companyId}/settings/salaryItems`).get()).data();
  return { items: Array.isArray(d?.items) ? d!.items : DEFAULT_SALARY_ITEMS, version: d?.version ?? 0 };
}

export async function updateSalaryItems(input: SalaryItemsInput, auth: AuthContext) {
  const names = input.items.map(i => i.name);
  if (new Set(names).size !== names.length) throw invalidArg('同じ名前の給与項目があります');
  const reserved = ['社員番号', '氏名', '支払基礎日数', '基本給', '現物給与', '遡及差額', '遡及開始月', '遡及終了月', '無給', '備考'];
  const bad = names.find(n => reserved.includes(n) || /^(固定|非固定)[:：]/.test(n));
  if (bad) throw invalidArg(`「${bad}」は給与項目の名前に使えません`);
  const ref = db.doc(`companies/${auth.companyId}/settings/salaryItems`);
  await db.runTransaction(async tx => {
    const current = await tx.get(ref);
    if ((current.data()?.version ?? 0) !== input.expectedVersion) throw invalidArg('給与項目が更新されています。画面を読み込み直してください');
    const now = Timestamp.now();
    tx.set(ref, { items: input.items, version: input.expectedVersion + 1, updatedBy: auth.uid, updatedAt: now });
    tx.set(db.collection(`companies/${auth.companyId}/auditLogs`).doc(), {
      entity: 'salaryItems', entityId: 'salaryItems', action: 'update',
      changes: { items: { from: current.data()?.items ?? null, to: input.items } }, performedBy: auth.uid, performedAt: now,
    });
  });
  return { success: true };
}

async function loadRun(input: RunInput, auth: AuthContext) {
  requireOffice(auth, input.officeId);
  const base = `companies/${auth.companyId}`;
  const office = await db.doc(`${base}/offices/${input.officeId}`).get();
  if (!office.exists) throw notFound('事業所');
  const officeData = office.data() as OfficeDoc;
  const deductionMethod: DeductionMethod = officeData.deductionMethod === 'current' ? 'current' : 'previous';
  const premiumMonth = premiumMonthFor(input.payMonth, deductionMethod);
  const runRef = db.doc(`${base}/monthlyRuns/${runId(input.officeId, input.payMonth)}`);
  return { base, office: officeData, deductionMethod, premiumMonth, runRef };
}

const nameOf = (e: FirebaseFirestore.DocumentData) => `${e.lastName ?? ''} ${e.firstName ?? ''}`.trim();
const iso = (v: unknown) => (v as Timestamp | undefined)?.toDate?.().toISOString() ?? null;

/** Firestore の getAll を300件ずつに分けて呼ぶ */
export async function getAllChunked(refs: FirebaseFirestore.DocumentReference[]) {
  const out: FirebaseFirestore.DocumentSnapshot[] = [];
  for (let i = 0; i < refs.length; i += 300) {
    const part = refs.slice(i, i + 300);
    if (part.length) out.push(...await db.getAll(...part));
  }
  return out;
}

function premiumFacts(d: FirebaseFirestore.DocumentData): PremiumFacts {
  return {
    employee: d.totalEmployeeAmount ?? 0, employer: d.totalEmployerAmount ?? 0,
    healthGrade: d.healthGradeNumber ?? 0, pensionGrade: d.pensionGradeNumber ?? 0,
    exempted: d.isExempted === true, longTermCare: d.isLongTermCareApplicable === true,
  };
}

export interface MonthlyRow {
  employeeId: string;
  employeeNumber: string;
  name: string;
  /** 支給月に在籍していて給与が要る */
  salaryRequired: boolean;
  /** 保険料が発生する（未計算の人は判定の見込み） */
  premiumDue: boolean;
  premiumNote: string;
  salary: null | { total: number; inKind: number; basisDays: number; noPay: boolean; noPayReason: string; confirmed: boolean; pending: boolean; published: boolean; version: number };
  premium: null | { employee: number; employer: number; healthGrade: number; pensionGrade: number; exempted: boolean; confirmed: boolean; pending: boolean; version: number };
  previous: null | { employee: number; employer: number };
  diff: number | null;
  diffReasons: string[];
  /** 計算・申請ができない理由 */
  issues: string[];
  /** 止める必要はないが確認したほうがよいこと */
  warnings: string[];
  collection: { plan: CollectionPlan; due: number; collected: number | null; status: CollectionStatus; version: number; entries: { method: string; amount: number; date: string; note: string }[] };
  hold: null | { reason: string };
  /** 計算した後に料率マスタが変わった（承認前なら計算し直す） */
  stale: boolean;
  /** 計算した後に変わったもの（'料率'・'等級'）。確定済み・依頼中でも出す（確定済みは訂正、依頼中は差し戻してから計算し直す） */
  outdated: string[];
  /** 差し戻しの理由（直して出し直すまで出す） */
  rejected: { salary: string | null; premium: string | null };
  /** 随時改定の可能性（この支給月が変動月から3か月目） */
  revision: RevisionAlert | null;
  /** 二以上事業所勤務のほかの勤め先（本システムでは対応しない） */
  otherEmployer: string | null;
}

/** 事業所と支給月の状況（全員分）。数百〜数千人でも1回で返す */
export async function monthlyOverview(input: RunInput, auth: AuthContext) {
  const { base, office, deductionMethod, premiumMonth, runRef } = await loadRun(input, auth);
  const { payMonth } = input;
  const employeesSnap = await db.collection(`${base}/employees`)
    .where('officeId', '==', input.officeId).where('deletedAt', '==', null)
    .orderBy('employeeNumber', 'asc').limit(MAX_JOB_TARGETS + 1).get();
  if (employeesSnap.size > MAX_JOB_TARGETS) throw invalidArg(`この事業所の従業員が${MAX_JOB_TARGETS}名を超えています。事業所を分けて処理してください`);
  const employees = employeesSnap.docs.filter(d => periodTarget(d.data(), payMonth) || periodTarget(d.data(), premiumMonth));

  const prevMonth = addMonths(premiumMonth, -1);
  const refs = employees.flatMap(d => {
    const e = `${base}/employees/${d.id}`;
    return [
      db.doc(`${e}/salaries/${payMonth}`), db.doc(`${e}/monthlyInsurance/${premiumMonth}`), db.doc(`${e}/monthlyInsurance/${prevMonth}`),
      db.doc(`${e}/collectionReceipts/${premiumMonth}`), db.doc(`${runRef.path}/holds/${d.id}`),
    ];
  });
  const [snaps, run, salaryItems, alerts] = await Promise.all([
    getAllChunked(refs), runRef.get(), salaryItemsOf(auth.companyId), revisionAlerts(auth.companyId, input.officeId, payMonth, employees.map(d => d.id)),
  ]);

  // 未計算の人だけ、等級と雇用条件（適用・適用外）を調べる
  const facts = await mapConcurrent(employees, 20, async (doc, i) => {
    if (snaps[i * 5 + 1].exists) return { hasGrade: true, standard: 0, enrolled: true };
    const e = `${base}/employees/${doc.id}`;
    const [grade, employment] = await Promise.all([
      db.collection(`${e}/grades`).where('effectiveMonth', '<=', premiumMonth).orderBy('effectiveMonth', 'desc').limit(1).get(),
      db.collection(`${e}/employments`).where('effectiveDate', '<=', lastDayOfMonth(premiumMonth)).orderBy('effectiveDate', 'desc').limit(1).get(),
    ]);
    const emp = employment.empty ? null : normalizeEmployment(employment.docs[0].data() as EmploymentDoc);
    return {
      hasGrade: !grade.empty,
      standard: grade.empty ? 0 : (grade.docs[0].data().healthStandardRemuneration ?? 0),
      enrolled: !emp || emp.healthInsuranceEnrolled || emp.pensionEnrolled,
    };
  });

  // 今の料率（この事業所・この月は全員同じ）。単位の誤りや未登録は、計算する前に知らせる
  let currentFingerprint: string | null = null;
  let rateIssue = '';
  try {
    const rates = await findAllRates(auth.companyId, premiumMonth, office.prefectureCode, office.insurerId, office.healthInsuranceType);
    currentFingerprint = rateFingerprint(rates);
    if (!rates.health) rateIssue = office.healthInsuranceType === 'union'
      ? `${premiumMonth}に使える組合健保（保険者番号 ${office.insurerId || '未入力'}）の健康保険料率が登録されていません（設定の「料率」で登録してください）`
      : `${premiumMonth}に使える健康保険料率が登録されていません（設定の料率マスタを確認してください）`;
    else if (!rates.pension) rateIssue = `${premiumMonth}に使える厚生年金保険料率が登録されていません`;
  } catch (e) {
    rateIssue = (e as Error).message;
  }

  const rows: MonthlyRow[] = employees.map((doc, i) => {
    const employee = doc.data() as EmployeeDoc;
    const [s, p, prev, r, h] = snaps.slice(i * 5, i * 5 + 5).map(x => x.data());
    const issues: string[] = [];
    const warnings: string[] = [];
    const salaryRequired = periodTarget(employee, payMonth);

    // 保険料が発生するか
    let premiumDue = false;
    let premiumNote = '';
    const { acquisitionDate, lossDate } = qualificationDates(employee);
    if (p) premiumDue = true;
    else if (!periodTarget(employee, premiumMonth)) premiumNote = `${premiumMonth}は在籍していません`;
    else if (!acquisitionDate) issues.push('資格取得日（入社日）が未登録');
    else {
      const coverage = coverageForMonth(acquisitionDate, lossDate, premiumMonth);
      if (!coverage.charged) premiumNote = coverage.reason;
      else if (!facts[i].enrolled) premiumNote = '社会保険の適用外';
      else {
        premiumDue = true;
        if (!facts[i].hasGrade) issues.push('適用中の等級がありません（入社の手続きで等級を決めてください）');
        if (!employee.birthDate) issues.push('生年月日が未入力');
        if (rateIssue) issues.push(rateIssue);
      }
    }
    if (salaryRequired && lossDate && lossDate.slice(0, 7) === addMonths(payMonth, 1) && deductionMethod === 'previous' && premiumDue) {
      warnings.push(`退職により、${payMonth}分の保険料もこの給与から控除する必要があります`);
    }

    const salary = s ? {
      total: s.totalSalary ?? 0, inKind: s.inKindAmount ?? 0, basisDays: s.paymentBasisDays ?? 0,
      noPay: s.noPay === true, noPayReason: s.noPayReason ?? '',
      confirmed: s.isConfirmed === true, pending: s.approvalPending === true, published: s.isPublished === true, version: s.version ?? 0,
    } : null;
    const premium = p ? {
      employee: p.totalEmployeeAmount ?? 0, employer: p.totalEmployerAmount ?? 0,
      healthGrade: p.healthGradeNumber ?? 0, pensionGrade: p.pensionGradeNumber ?? 0, exempted: p.isExempted === true,
      confirmed: p.isConfirmed === true, pending: p.approvalPending === true, version: p.version ?? 0,
    } : null;
    // 計算の前に止めるものではなく、計算し直しを促す（止めると「計算する」が押せない）
    if (p && premiumMonth >= '2026-04' && !p.childSupportPayment) warnings.push(p.isConfirmed ? '子ども・子育て支援金が入っていません。保険料を訂正して計算し直してください' : '子ども・子育て支援金を含めて計算し直してください');

    // 料率は額が変わりうるときだけ（同じ値の料率が足されただけなら出さない）。等級は等級の書き込みのトリガーが印を付ける（grades/outdated.ts）
    const outdated: string[] = [];
    if (p && typeof p.rateFingerprint === 'string' && currentFingerprint !== null && rateValuesChanged(p.rateFingerprint, currentFingerprint, premiumMonth)) outdated.push('料率');
    if (p?.gradeOutdated === true) outdated.push('等級');
    const stale = outdated.length > 0 && !p!.isConfirmed && !p!.approvalPending;
    if (outdated.length) {
      const what = outdated.join('と');
      warnings.push(p!.isConfirmed ? `確定した後に${what}が変わりました。保険料を訂正して計算し直してください`
        : p!.approvalPending ? `確認を依頼した後に${what}が変わりました。差し戻してから計算し直してください`
        : `計算した後に${what}が変わりました。計算し直してください`);
    }
    const rejectionOf = (d: FirebaseFirestore.DocumentData | undefined) =>
      d?.lastRejection && !d.isConfirmed && !d.approvalPending ? String(d.lastRejection.comment || '理由の記入なし') : null;
    const reasons = p ? diffReasons(premiumFacts(p), prev ? premiumFacts(prev) : null) : [];
    const standard = p ? (p.healthStandardRemuneration ?? 0) : facts[i].standard;
    const revision = alerts.get(doc.id) ?? null;
    // 手続きを始めるまでは確認を促す
    if (revision && !revision.procedureId) warnings.push(revision.text);
    else if (salary && !salary.noPay && !revision) {
      const w = remunerationWarning(salary.total + salary.inKind, standard);
      if (w) warnings.push(w);
    }

    const due = premium?.employee ?? 0;
    const plan = collectionPlan(due, salary ? { total: salary.total, noPay: salary.noPay } : null);
    if (premium && plan === 'transfer') warnings.push(salary?.noPay ? '無給のため、本人負担分は別途入金で集めます' : salary ? '給与が本人負担分より少ないため、別途入金で集めます' : 'この月の給与がないため、本人負担分は別途入金で集めます');
    const collected = typeof r?.collectedAmount === 'number' ? r.collectedAmount : null;

    return {
      employeeId: doc.id, employeeNumber: employee.employeeNumber ?? '', name: nameOf(employee),
      salaryRequired, premiumDue, premiumNote, salary, premium,
      previous: prev ? { employee: prev.totalEmployeeAmount ?? 0, employer: prev.totalEmployerAmount ?? 0 } : null,
      diff: p && prev ? (p.totalEmployeeAmount ?? 0) + (p.totalEmployerAmount ?? 0) - (prev.totalEmployeeAmount ?? 0) - (prev.totalEmployerAmount ?? 0) : null,
      diffReasons: reasons, issues, warnings,
      collection: {
        plan, due, collected, status: collectionStatus(due, collected), version: r?.version ?? 0,
        entries: Array.isArray(r?.entries) ? r!.entries : (collected !== null ? [{ method: 'legacy', amount: collected, date: '', note: r?.note ?? '' }] : []),
      },
      hold: h?.reason ? { reason: h.reason } : null,
      stale, outdated,
      rejected: { salary: rejectionOf(s), premium: rejectionOf(p) },
      revision,
      otherEmployer: employee.otherEmployer?.name ?? null,
    };
  });

  const sum = (f: (r: MonthlyRow) => number) => rows.reduce((a, r) => a + f(r), 0);
  const runData = run.data() ?? {};
  let job = null;
  if (runData.latestJobId) job = await jobSummary(base, runData.latestJobId);
  return {
    office: { id: input.officeId, name: office.name ?? '' },
    payMonth, premiumMonth, deductionMethod,
    totals: {
      employee: sum(r => r.premium?.employee ?? 0), employer: sum(r => r.premium?.employer ?? 0),
      previousEmployee: sum(r => r.premium ? r.previous?.employee ?? 0 : 0), previousEmployer: sum(r => r.premium ? r.previous?.employer ?? 0 : 0),
      salary: sum(r => r.salary?.total ?? 0), collected: sum(r => r.collection.collected ?? 0), due: sum(r => r.collection.due),
    },
    reviews: {
      salary: runData.salaryReview ? { requestedBy: runData.salaryReview.requestedBy, requestedAt: iso(runData.salaryReview.requestedAt), mine: runData.salaryReview.requestedBy === auth.uid } : null,
      premium: runData.premiumReview ? { requestedBy: runData.premiumReview.requestedBy, requestedAt: iso(runData.premiumReview.requestedAt), mine: runData.premiumReview.requestedBy === auth.uid } : null,
    },
    me: { uid: auth.uid, canApprove: auth.roles.some(r => r === 'admin' || r === 'approver') },
    salaryItems,
    rows,
    job,
  };
}

export async function setMonthlyHold(input: HoldInput, auth: AuthContext) {
  const { base, runRef } = await loadRun(input, auth);
  const ref = db.doc(`${runRef.path}/holds/${input.employeeId}`);
  await db.runTransaction(async tx => {
    const employee = await tx.get(db.doc(`${base}/employees/${input.employeeId}`));
    if (!employee.exists || employee.data()!.deletedAt != null) throw notFound('従業員');
    if (employee.data()!.officeId !== input.officeId) throw invalidArg('対象の事業所が一致しません');
    const current = await tx.get(ref);
    const now = Timestamp.now();
    if (input.reason) tx.set(ref, { reason: input.reason, updatedBy: auth.uid, updatedAt: now });
    else tx.delete(ref);
    tx.set(db.collection(`${base}/auditLogs`).doc(), {
      entity: 'monthlyRun', entityId: runRef.id, employeeId: input.employeeId, action: 'update',
      changes: { hold: { from: current.data()?.reason ?? null, to: input.reason } }, performedBy: auth.uid, performedAt: now,
    });
  });
  return { success: true };
}

// ---- 給与 ----

const sumOf = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);

/** 給与CSVの確認（dryRun）と取込。誤りのある行は取り込まず、一覧で返す */
export async function importMonthlySalary(input: ImportInput, auth: AuthContext) {
  const { base } = await loadRun(input, auth);
  const parsed = parseSalaryCsv(input.csv, (await salaryItemsOf(auth.companyId)).items);
  const errors = [...parsed.errors];
  const employees = await db.collection(`${base}/employees`).where('officeId', '==', input.officeId).where('deletedAt', '==', null).get();
  const byNumber = new Map(employees.docs.map(d => [String(d.data().employeeNumber ?? ''), d]));
  const valid = parsed.rows.filter(row => {
    const doc = byNumber.get(row.employeeNumber);
    if (!doc) errors.push({ line: row.line, employeeNumber: row.employeeNumber, message: 'この事業所に、この社員番号の従業員がいません' });
    else if (!periodTarget(doc.data(), input.payMonth)) errors.push({ line: row.line, employeeNumber: row.employeeNumber, message: `${input.payMonth}に在籍していません` });
    else return true;
    return false;
  });
  const existing = await getAllChunked(valid.map(row => db.doc(`${base}/employees/${byNumber.get(row.employeeNumber)!.id}/salaries/${input.payMonth}`)));
  const plan = valid.flatMap((row, i) => {
    const d = existing[i].data();
    if (d?.isConfirmed || d?.approvalPending) {
      errors.push({ line: row.line, employeeNumber: row.employeeNumber, message: d.isConfirmed ? '承認済みの給与は上書きできません（差し戻してから取り込んでください）' : '確認の依頼中のため上書きできません' });
      return [];
    }
    const employee = byNumber.get(row.employeeNumber)!;
    const total = row.baseSalary + sumOf(row.fixedAllowances) + sumOf(row.variableAllowances);
    return [{ row, employeeId: employee.id, name: nameOf(employee.data()), total, overwrite: existing[i].exists, version: d?.version ?? 0 }];
  });
  errors.sort((a, b) => a.line - b.line);
  const preview = plan.map(p => ({ line: p.row.line, employeeNumber: p.row.employeeNumber, name: p.name, total: p.total, inKind: p.row.inKindAmount, noPay: p.row.noPay, overwrite: p.overwrite }));
  if (input.dryRun) return { dryRun: true, rows: preview, errors, imported: 0 };

  for (let i = 0; i < plan.length; i += 20) {
    const part = plan.slice(i, i + 20);
    await db.runTransaction(async tx => {
      const refs = part.map(p => db.doc(`${base}/employees/${p.employeeId}/salaries/${input.payMonth}`));
      const current = await Promise.all(refs.map(ref => tx.get(ref)));
      const now = Timestamp.now();
      part.forEach((p, k) => {
        const d = current[k].data();
        if ((d?.version ?? 0) !== p.version || d?.isConfirmed || d?.approvalPending) throw invalidArg(`${p.row.employeeNumber}の給与が取込中に変更されました。もう一度確認してください`);
        const totalFixedWage = p.row.baseSalary + sumOf(p.row.fixedAllowances);
        const totalVariableWage = sumOf(p.row.variableAllowances);
        tx.set(refs[k], {
          yearMonth: input.payMonth, officeId: input.officeId, paymentBasisDays: p.row.paymentBasisDays,
          baseSalary: p.row.baseSalary, fixedAllowances: p.row.fixedAllowances, variableAllowances: p.row.variableAllowances,
          totalFixedWage, totalVariableWage, totalSalary: totalFixedWage + totalVariableWage,
          inKindAmount: p.row.inKindAmount, retroactivePay: p.row.retroactivePay,
          noPay: p.row.noPay, noPayReason: p.row.noPay ? 'CSVで無給として取込' : null, source: 'csv',
          isConfirmed: false, approvalPending: false, confirmedAt: null, confirmedBy: null,
          version: (d?.version ?? 0) + 1, createdAt: d?.createdAt ?? now, updatedAt: now,
        });
        tx.set(db.collection(`${base}/auditLogs`).doc(), {
          entity: 'salary', entityId: `${p.employeeId}/${input.payMonth}`, action: d ? 'update' : 'create',
          changes: { source: { from: null, to: 'monthlyCsvImport' } }, performedBy: auth.uid, performedAt: now, version: (d?.version ?? 0) + 1,
        });
      });
    });
  }
  return { dryRun: false, rows: preview, errors, imported: plan.length };
}

/** 給与のない月（無給の休職など）として記録する */
export async function markNoPay(input: NoPayInput, auth: AuthContext) {
  const { base } = await loadRun(input, auth);
  const ref = db.doc(`${base}/employees/${input.employeeId}/salaries/${input.payMonth}`);
  await db.runTransaction(async tx => {
    const [employee, current] = await Promise.all([tx.get(db.doc(`${base}/employees/${input.employeeId}`)), tx.get(ref)]);
    if (!employee.exists || employee.data()!.deletedAt != null) throw notFound('従業員');
    if (employee.data()!.officeId !== input.officeId) throw invalidArg('対象の事業所が一致しません');
    const d = current.data();
    if (d?.isConfirmed || d?.approvalPending) throw invalidArg('承認済み・確認の依頼中の給与は変更できません');
    const now = Timestamp.now();
    tx.set(ref, {
      yearMonth: input.payMonth, officeId: input.officeId, paymentBasisDays: 0, baseSalary: 0, fixedAllowances: {}, variableAllowances: {},
      totalFixedWage: 0, totalVariableWage: 0, totalSalary: 0, inKindAmount: 0, retroactivePay: null,
      noPay: true, noPayReason: input.reason, source: 'noPay',
      isConfirmed: false, approvalPending: false, confirmedAt: null, confirmedBy: null,
      version: (d?.version ?? 0) + 1, createdAt: d?.createdAt ?? now, updatedAt: now,
    });
    tx.set(db.collection(`${base}/auditLogs`).doc(), {
      entity: 'salary', entityId: `${input.employeeId}/${input.payMonth}`, action: d ? 'update' : 'create',
      changes: { noPay: { from: d?.noPay ?? null, to: true } }, note: input.reason, performedBy: auth.uid, performedAt: now,
    });
  });
  return { success: true };
}

// ---- 徴収 ----

/** 徴収の記録を1件足す（給与控除・別途入金・返金） */
export async function addCollectionEntry(input: CollectionEntryInput, auth: AuthContext) {
  const { base, premiumMonth } = await loadRun(input, auth);
  const employeeBase = `${base}/employees/${input.employeeId}`;
  const ref = db.doc(`${employeeBase}/collectionReceipts/${premiumMonth}`);
  await db.runTransaction(async tx => {
    const [employee, insurance, current] = await Promise.all([
      tx.get(db.doc(employeeBase)), tx.get(db.doc(`${employeeBase}/monthlyInsurance/${premiumMonth}`)), tx.get(ref),
    ]);
    if (!employee.exists || employee.data()!.deletedAt != null) throw notFound('従業員');
    if (employee.data()!.officeId !== input.officeId) throw invalidArg('対象の事業所が一致しません');
    if (!insurance.exists || insurance.data()!.isConfirmed !== true) throw invalidArg('保険料の承認が済んでから記録してください');
    const d = current.data();
    if ((d?.version ?? 0) !== input.expectedVersion) throw invalidArg('徴収の記録が更新されています。画面を読み込み直してください');
    const collected = typeof d?.collectedAmount === 'number' ? d.collectedAmount : 0;
    if (input.method === 'refund' && input.amount > collected) throw invalidArg(`返金額が徴収済みの金額（${collected.toLocaleString('ja-JP')}円）を超えています`);
    const next = collected + (input.method === 'refund' ? -input.amount : input.amount);
    const now = Timestamp.now();
    const entries = [...(Array.isArray(d?.entries) ? d!.entries : []), { method: input.method, amount: input.amount, date: input.date, note: input.note, recordedBy: auth.uid }];
    tx.set(ref, {
      yearMonth: premiumMonth, officeId: input.officeId, dueAmount: insurance.data()!.totalEmployeeAmount ?? 0,
      collectedAmount: next, entries, note: input.note, updatedBy: auth.uid, updatedAt: now, version: (d?.version ?? 0) + 1,
    });
    tx.set(db.collection(`${base}/auditLogs`).doc(), {
      entity: 'collectionReceipt', employeeId: input.employeeId, entityId: premiumMonth, action: 'update',
      changes: { collectedAmount: { from: d?.collectedAmount ?? null, to: next } }, note: `${input.method}: ${input.note}`,
      performedBy: auth.uid, performedAt: now, version: (d?.version ?? 0) + 1,
    });
  });
  return { success: true };
}

// ---- 一括処理（バックグラウンド） ----

const ACTION_LABEL: Record<MonthlyAction, string> = {
  requestSalaryApproval: '給与の確認の依頼', approveSalary: '給与の承認', calculate: '保険料の計算',
  requestPremiumApproval: '保険料の確認の依頼', approvePremium: '保険料の承認', publish: '明細の公開', recordPayroll: '給与からの控除の記録',
  correctPremium: '保険料の訂正',
};

/** 一括処理を登録する。実際の処理は chunks の作成をきっかけにバックグラウンドで行う */
export async function startMonthlyJob(input: JobStartInput, auth: AuthContext) {
  const { base, premiumMonth, runRef } = await loadRun(input, auth);
  if ((input.action === 'approveSalary' || input.action === 'approvePremium') && !auth.roles.some(r => r === 'admin' || r === 'approver')) {
    throw invalidArg('承認できるのは管理者・承認者です');
  }
  const ids = [...new Set(input.employeeIds)];
  const jobRef = db.collection(`${base}/monthlyJobs`).doc();
  await db.runTransaction(async tx => {
    const run = await tx.get(runRef);
    const latest = run.data()?.latestJobId as string | undefined;
    if (latest) {
      const job = await tx.get(db.doc(`${base}/monthlyJobs/${latest}`));
      const j = job.data();
      if (j && j.status === 'running' && j.createdAt.toMillis() > Date.now() - STALE_MS) throw invalidArg('前の処理がまだ終わっていません。終わってから実行してください');
    }
    const now = Timestamp.now();
    const review = input.action === 'requestSalaryApproval' ? { salaryReview: { requestedBy: auth.uid, requestedAt: now } }
      : input.action === 'requestPremiumApproval' ? { premiumReview: { requestedBy: auth.uid, requestedAt: now } } : {};
    tx.set(runRef, { officeId: input.officeId, payMonth: input.payMonth, premiumMonth, latestJobId: jobRef.id, updatedAt: now, ...review }, { merge: true });
    tx.set(jobRef, {
      runId: runRef.id, officeId: input.officeId, payMonth: input.payMonth, premiumMonth, action: input.action,
      total: ids.length, processed: 0, succeeded: 0, failed: 0, status: 'running',
      createdBy: auth.uid, createdAt: now, updatedAt: now, completedAt: null,
    });
    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      tx.set(db.doc(`${jobRef.path}/chunks/${String(i / CHUNK_SIZE).padStart(4, '0')}`), { employeeIds: ids.slice(i, i + CHUNK_SIZE), done: false, createdAt: now });
    }
  });
  return { jobId: jobRef.id };
}

async function jobSummary(base: string, jobId: string) {
  const job = await db.doc(`${base}/monthlyJobs/${jobId}`).get();
  if (!job.exists) return null;
  const j = job.data()!;
  const stalled = j.status === 'running' && j.createdAt.toMillis() < Date.now() - STALE_MS;
  return {
    id: job.id, action: j.action as MonthlyAction, label: ACTION_LABEL[j.action as MonthlyAction] ?? j.action,
    total: j.total, processed: j.processed, succeeded: j.succeeded, failed: j.failed,
    status: stalled ? 'stalled' : j.status as 'running' | 'completed', createdAt: iso(j.createdAt), completedAt: iso(j.completedAt),
  };
}

export async function getMonthlyJob(input: JobGetInput, auth: AuthContext) {
  const { base, runRef } = await loadRun(input, auth);
  const job = await db.doc(`${base}/monthlyJobs/${input.jobId}`).get();
  if (!job.exists || job.data()!.runId !== runRef.id) throw notFound('一括処理');
  const failures = await db.collection(`${job.ref.path}/failures`).limit(MAX_JOB_TARGETS).get();
  return {
    job: await jobSummary(base, input.jobId),
    failures: failures.docs.map(d => ({ employeeId: d.id, message: d.data().message as string })),
  };
}

/** トリガーでは呼び出し元がいないため、ジョブを登録した人の権限をその時点の利用者情報から作り直す */
export async function authOf(companyId: string, uid: string): Promise<AuthContext> {
  const user = await db.doc(`companies/${companyId}/users/${uid}`).get();
  const d = user.data();
  if (!d || d.isSuspended || d.isLoginDisabled) throw invalidArg('処理を登録した利用者の権限を確認できません');
  return { uid, companyId, roles: (d.roles ?? []) as Role[], officeIds: d.officeIds ?? [], employeeId: d.employeeId ?? null, isSuspended: false, isLoginDisabled: false, sessionId: 'trigger' };
}

/**
 * 承認済みの保険料の訂正（カタログ6章）：前の内容を訂正の履歴と監査ログに残して未確定に戻す。未確定なら何もしない。
 * このあと「計算する」→「確認を依頼する」→ 別の人が承認、のいつもの流れで確定し直す（等級の遡及訂正からも使う）
 */
export async function reopenPremium(auth: AuthContext, employeeId: string, premiumMonth: string, reason: string): Promise<boolean> {
  const base = `companies/${auth.companyId}`;
  const premiumRef = db.doc(`${base}/employees/${employeeId}/monthlyInsurance/${premiumMonth}`);
  return db.runTransaction(async tx => {
    const cur = await tx.get(premiumRef);
    const d = cur.data();
    if (!d) throw invalidArg('保険料が計算されていません');
    if (d.approvalPending) throw invalidArg('確認を依頼中です。差し戻してから訂正してください');
    if (d.isConfirmed !== true) return false;
    const now = Timestamp.now();
    const version = (d.version ?? 1) + 1;
    tx.set(db.collection(`${premiumRef.path}/corrections`).doc(), { before: d, correctedBy: auth.uid, correctedAt: now, reason });
    tx.update(premiumRef, { isConfirmed: false, confirmedAt: null, confirmedBy: null, correctedAt: now, correctionCount: (d.correctionCount ?? 0) + 1, correctionReason: reason, version, updatedAt: now });
    tx.set(db.collection(`${base}/auditLogs`).doc(), {
      entity: 'monthlyInsurance', entityId: `${employeeId}/${premiumMonth}`, action: 'correctionStart',
      changes: { isConfirmed: { from: true, to: false }, totalEmployeeAmount: { from: d.totalEmployeeAmount ?? null, to: null }, totalEmployerAmount: { from: d.totalEmployerAmount ?? null, to: null }, reason },
      employeeId, performedBy: auth.uid, performedAt: now, version,
    });
    return true;
  });
}

/** 1人分の処理。成功ならメッセージ、失敗なら例外 */
async function processOne(action: MonthlyAction, employeeId: string, job: FirebaseFirestore.DocumentData, auth: AuthContext): Promise<void> {
  const base = `companies/${auth.companyId}`;
  const e = `${base}/employees/${employeeId}`;
  const { payMonth, premiumMonth, officeId, runId: run } = job;
  const [employee, hold] = await getAllChunked([db.doc(e), db.doc(`${base}/monthlyRuns/${run}/holds/${employeeId}`)]);
  if (!employee.exists || employee.data()!.deletedAt != null) throw notFound('従業員');
  if (employee.data()!.officeId !== officeId) throw invalidArg('対象の事業所が一致しません');
  if (hold.data()?.reason) throw invalidArg(`保留中です（${hold.data()!.reason}）`);
  const salaryRef = db.doc(`${e}/salaries/${payMonth}`);
  const premiumRef = db.doc(`${e}/monthlyInsurance/${premiumMonth}`);
  const [salary, premium] = await getAllChunked([salaryRef, premiumRef]);
  const s = salary.data();
  const p = premium.data();

  switch (action) {
    case 'requestSalaryApproval':
      if (!s) throw invalidArg('給与が登録されていません');
      if (s.isConfirmed || s.approvalPending) return;
      await createApprovalRequest({ companyId: auth.companyId, employeeId, requestType: 'salary', targetPath: salaryRef.path, targetVersion: s.version }, auth, { notify: false })
        .catch(err => { throw (err.message ?? '').includes('再計算') ? invalidArg('差し戻された給与です。内容を直してから依頼してください') : err; });
      return;
    case 'approveSalary':
      if (!s?.approvalPending) throw invalidArg(s?.isConfirmed ? '承認済みです' : '確認の依頼がありません');
      await approveApprovalRequest({ companyId: auth.companyId, employeeId, requestId: `salary-${payMonth}-v${s.version}` }, auth, { notify: false });
      return;
    case 'calculate':
      if (p?.isConfirmed || p?.approvalPending) return;
      await calculateMonthlyInsurance({ companyId: auth.companyId, employeeId, yearMonth: premiumMonth }, auth);
      return;
    case 'requestPremiumApproval':
      if (!p) throw invalidArg('保険料が計算されていません');
      if (p.isConfirmed || p.approvalPending) return;
      if (premiumMonth >= '2026-04' && !p.childSupportPayment) throw invalidArg('子ども・子育て支援金を含めて計算し直してください');
      await createApprovalRequest({ companyId: auth.companyId, employeeId, requestType: 'monthlyInsurance', targetPath: premiumRef.path, targetVersion: p.version }, auth, { notify: false });
      return;
    case 'correctPremium':
      await reopenPremium(auth, employeeId, premiumMonth, '承認済みの保険料の訂正（計算し直し）');
      return;
    case 'approvePremium':
      if (!p?.approvalPending) throw invalidArg(p?.isConfirmed ? '承認済みです' : '確認の依頼がありません');
      await approveApprovalRequest({ companyId: auth.companyId, employeeId, requestId: `monthlyInsurance-${premiumMonth}-v${p.version}` }, auth, { notify: false });
      return;
    case 'publish':
      await db.runTransaction(async tx => {
        const [sal, ins] = await Promise.all([tx.get(salaryRef), tx.get(premiumRef)]);
        const sd = sal.data();
        if (!sd?.isConfirmed) throw invalidArg('給与の承認が済んでいません');
        if (sd.isPublished) return;
        if (ins.exists && ins.data()!.isConfirmed !== true) throw invalidArg('保険料の承認が済んでいません');
        const now = Timestamp.now();
        tx.update(salaryRef, {
          isPublished: true, publishedAt: now, publishedBy: auth.uid,
          deductedPremiumMonth: ins.exists ? premiumMonth : null, updatedAt: now, version: (sd.version ?? 0) + 1,
        });
        tx.set(db.collection(`${base}/auditLogs`).doc(), { entity: 'salary', entityId: payMonth, action: 'publish', employeeId, performedBy: auth.uid, performedAt: now });
      });
      return;
    case 'recordPayroll': {
      if (!p?.isConfirmed) throw invalidArg('保険料の承認が済んでいません');
      const due = p.totalEmployeeAmount ?? 0;
      if (collectionPlan(due, s ? { total: s.totalSalary ?? 0, noPay: s.noPay === true } : null) !== 'payroll') throw invalidArg('給与から控除できません。別途入金で記録してください');
      const ref = db.doc(`${e}/collectionReceipts/${premiumMonth}`);
      await db.runTransaction(async tx => {
        const current = await tx.get(ref);
        const d = current.data();
        if (Array.isArray(d?.entries) && d!.entries.some((x: { method: string }) => x.method === 'payroll')) return;
        const now = Timestamp.now();
        const collected = (typeof d?.collectedAmount === 'number' ? d.collectedAmount : 0) + due;
        tx.set(ref, {
          yearMonth: premiumMonth, officeId, dueAmount: due, collectedAmount: collected,
          entries: [...(d?.entries ?? []), { method: 'payroll', amount: due, date: '', note: `${payMonth}支給の給与から控除`, recordedBy: auth.uid }],
          note: `${payMonth}支給の給与から控除`, updatedBy: auth.uid, updatedAt: now, version: (d?.version ?? 0) + 1,
        });
      });
      return;
    }
  }
}

/** chunks の1件を処理する（Firestore のトリガーから呼ぶ） */
export async function processMonthlyChunk(companyId: string, jobId: string, chunkId: string) {
  const jobRef = db.doc(`companies/${companyId}/monthlyJobs/${jobId}`);
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

  // 最後の chunk を終えた処理だけが、完了の記録と通知を行う
  const finished = await db.runTransaction(async tx => {
    const current = (await tx.get(jobRef)).data()!;
    if (current.status !== 'running' || current.processed < current.total) return null;
    tx.update(jobRef, { status: 'completed', completedAt: Timestamp.now() });
    return current;
  });
  if (finished) {
    const { notify } = await import('../utils/notify');
    const label = ACTION_LABEL[finished.action as MonthlyAction];
    const forReviewer = finished.action === 'requestSalaryApproval' || finished.action === 'requestPremiumApproval';
    await notify({
      companyId, category: forReviewer ? 'approval' : 'salary', targetType: 'monthlyRun', targetId: finished.runId, createdBy: finished.createdBy,
      title: forReviewer ? `毎月の処理：${label}` : `毎月の処理：${label}が終わりました`,
      body: `${finished.payMonth}支給分 ${finished.total}名中 ${finished.succeeded}名が完了${finished.failed ? `、${finished.failed}名が失敗` : ''}${forReviewer ? '。毎月の処理の画面で確認して承認してください' : ''}`,
    });
  }
}
