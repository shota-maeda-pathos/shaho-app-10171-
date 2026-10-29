import { db } from '../config';
import { AuthContext, requireOffice } from '../middleware/auth';
import { EmployeeDoc, EmploymentDoc, GradeDoc, OfficeDoc, SalaryDoc } from '../types/firestore';
import { invalidArg, notFound } from '../utils/errors';
import { findApplicableRate } from '../utils/insurance-rate';
import { normalizeEmployment, qualificationDates } from '../utils/employment';
import { resolveGradeTable } from '../insurance/calculator';
import { createApprovalRequest } from '../approvals/approval-request-create/service';
import { computeSanteiRow, SanteiEmployeeData, SanteiRow, santeiCurrentGradeMonth, santeiEffectiveMonth } from './santei-calc';
import { SanteiPreviewInput, SanteiSubmitInput } from './schema';

const base = (companyId: string) => `companies/${companyId}`;

/** 定時決定の承認対象パス（等級の文書IDは適用開始月） */
export function santeiGradePath(companyId: string, employeeId: string, year: number): string {
  return `${base(companyId)}/employees/${employeeId}/grades/${santeiEffectiveMonth(year)}`;
}

async function gradeTables(companyId: string, office: OfficeDoc | undefined, year: number) {
  const ym = santeiEffectiveMonth(year);
  const [health, pension] = await Promise.all([
    findApplicableRate({ companyId, insuranceType: 'health', yearMonth: ym, prefectureCode: office?.prefectureCode, insurerId: office?.insurerId }),
    findApplicableRate({ companyId, insuranceType: 'pension', yearMonth: ym }),
  ]);
  return { health: resolveGradeTable('health', health?.gradeTable), pension: resolveGradeTable('pension', pension?.gradeTable) };
}

async function loadEmployeeData(companyId: string, employeeId: string, employee: EmployeeDoc, year: number): Promise<SanteiEmployeeData> {
  const empPath = `${base(companyId)}/employees/${employeeId}`;
  const months = ['04', '05', '06'].map(m => `${year}-${m}`);
  const [employmentSnap, gradeSnap, revisionSnap, approvalSnap, ...salarySnaps] = await Promise.all([
    db.collection(`${empPath}/employments`).where('effectiveDate', '<=', `${year}-07-01`).orderBy('effectiveDate', 'desc').limit(1).get(),
    db.collection(`${empPath}/grades`).where('effectiveMonth', '<=', santeiCurrentGradeMonth(year)).orderBy('effectiveMonth', 'desc').limit(1).get(),
    db.collection(`${empPath}/grades`).where('effectiveMonth', '>=', `${year}-07`).where('effectiveMonth', '<=', `${year}-09`).get(),
    db.collection(`${empPath}/approvalRequests`).where('targetPath', '==', santeiGradePath(companyId, employeeId, year)).get(),
    ...months.map(ym => db.doc(`${empPath}/salaries/${ym}`).get()),
  ]);
  const employment = employmentSnap.empty ? null : normalizeEmployment(employmentSnap.docs[0].data() as EmploymentDoc);
  const { acquisitionDate, lossDate } = qualificationDates(employee);
  const approvals = approvalSnap.docs.map(d => d.data().status as string);
  return {
    employeeId,
    employeeNumber: employee.employeeNumber,
    employeeName: `${employee.lastName} ${employee.firstName}`,
    acquisitionDate,
    lossDate,
    enrolled: employment === null || employment.healthInsuranceEnrolled || employment.pensionEnrolled,
    insuredCategory: employment?.insuredCategory ?? 'general',
    salaries: Object.fromEntries(months.map((ym, i) => [ym, salarySnaps[i].exists ? salarySnaps[i].data() as SalaryDoc : null])),
    currentGrade: gradeSnap.empty ? null : gradeSnap.docs[0].data() as GradeDoc,
    hasOccasionalRevisionJulToSep: revisionSnap.docs.some(d => (d.data() as GradeDoc).determinationType === 'occasional'),
    approvalStatus: approvals.includes('approved') ? 'approved' : approvals.includes('pending') ? 'pending' : 'none',
  };
}

export interface SanteiPreviewResponse {
  year: number;
  effectiveMonth: string;
  /** 届出期間 */
  filingPeriod: { from: string; to: string };
  items: SanteiRow[];
  hasMore: boolean;
  lastDocId?: string;
}

/**
 * 算定基礎届の対象者一覧。全員分を一度に計算すると重いため、社員番号順にページ単位で返す。
 * 支払基礎日数・平均・新旧等級はすべてサーバーで計算する。
 */
export async function previewSantei(input: SanteiPreviewInput, auth: AuthContext): Promise<SanteiPreviewResponse> {
  if (input.officeId) requireOffice(auth, input.officeId);
  const targetOfficeIds = auth.roles.includes('admin') ? null : auth.officeIds;
  const empty = { year: input.year, effectiveMonth: santeiEffectiveMonth(input.year), filingPeriod: { from: `${input.year}-07-01`, to: `${input.year}-07-10` }, items: [], hasMore: false };
  if (targetOfficeIds && targetOfficeIds.length === 0) return empty;
  if (!input.officeId && targetOfficeIds && targetOfficeIds.length > 30) throw invalidArg('担当事業所が多いため、事業所を選択してください');

  let docs: FirebaseFirestore.DocumentSnapshot[];
  let hasMore = false;
  if (input.employeeIds?.length) {
    // 個別確認：指定された従業員だけを取得し、担当事業所を確認する
    const snaps = await Promise.all(input.employeeIds.map(id => db.doc(`${base(auth.companyId)}/employees/${id}`).get()));
    docs = snaps.filter(d => d.exists && d.data()!.deletedAt === null);
    for (const d of docs) if (!auth.roles.includes('admin')) requireOffice(auth, (d.data() as EmployeeDoc).officeId);
  } else {
    let query: FirebaseFirestore.Query = db.collection(`${base(auth.companyId)}/employees`)
      .where('deletedAt', '==', null)
      .orderBy('employeeNumber', 'asc');
    // 本番に既にある索引（deletedAt・officeId・employeeNumber）を使うため、管理者も事業所で絞り込む
    const officeIds = input.officeId ? [input.officeId]
      : targetOfficeIds ?? (await db.collection(`${base(auth.companyId)}/offices`).get()).docs.map(d => d.id);
    if (officeIds.length === 0) return empty;
    if (officeIds.length > 30) throw invalidArg('事業所が多いため、事業所を選択してください');
    query = officeIds.length === 1 ? query.where('officeId', '==', officeIds[0]) : query.where('officeId', 'in', officeIds);
    if (input.lastDocId) {
      const last = await db.doc(`${base(auth.companyId)}/employees/${input.lastDocId}`).get();
      if (last.exists) query = query.startAfter(last);
    }
    const snap = await query.limit(input.limit + 1).get();
    hasMore = snap.docs.length > input.limit;
    docs = hasMore ? snap.docs.slice(0, input.limit) : snap.docs;
  }

  const offices = new Map<string, OfficeDoc | undefined>();
  const tablesByOffice = new Map<string, Awaited<ReturnType<typeof gradeTables>>>();
  const items: SanteiRow[] = [];
  for (const doc of docs) {
    const employee = doc.data() as EmployeeDoc;
    if (!offices.has(employee.officeId)) {
      const officeSnap = await db.doc(`${base(auth.companyId)}/offices/${employee.officeId}`).get();
      offices.set(employee.officeId, officeSnap.exists ? officeSnap.data() as OfficeDoc : undefined);
      tablesByOffice.set(employee.officeId, await gradeTables(auth.companyId, offices.get(employee.officeId), input.year));
    }
    const data = await loadEmployeeData(auth.companyId, doc.id, employee, input.year);
    items.push(computeSanteiRow(input.year, data, tablesByOffice.get(employee.officeId)!));
  }
  return { ...empty, items, hasMore, lastDocId: docs.length ? docs[docs.length - 1].id : undefined };
}

export interface SanteiSubmitResult {
  employeeId: string;
  ok: boolean;
  requestId?: string;
  error?: string;
}

/**
 * 定時決定の承認申請。画面から送られた値は使わず、サーバーで再計算した値で申請する。
 * 等級が変わらない人も定時決定の対象として申請する。1人の失敗で他の人を止めない。
 */
export async function submitSantei(input: SanteiSubmitInput, auth: AuthContext): Promise<{ results: SanteiSubmitResult[] }> {
  const results: SanteiSubmitResult[] = [];
  for (const employeeId of input.employeeIds) {
    try {
      const empSnap = await db.doc(`${base(auth.companyId)}/employees/${employeeId}`).get();
      if (!empSnap.exists || empSnap.data()!.deletedAt !== null) throw notFound('従業員');
      const employee = empSnap.data() as EmployeeDoc;
      if (!auth.roles.includes('admin')) requireOffice(auth, employee.officeId);
      const officeSnap = await db.doc(`${base(auth.companyId)}/offices/${employee.officeId}`).get();
      const tables = await gradeTables(auth.companyId, officeSnap.exists ? officeSnap.data() as OfficeDoc : undefined, input.year);
      const row = computeSanteiRow(input.year, await loadEmployeeData(auth.companyId, employeeId, employee, input.year), tables);
      if (row.status !== 'ok' || !row.proposed) throw invalidArg(row.reason || '算定の対象ではありません');
      if (row.approvalStatus !== 'none') throw invalidArg(row.approvalStatus === 'pending' ? '既に承認申請中です' : '既に承認済みです');
      const usedMonths = row.months.filter(m => m.used).map(m => `${Number(m.yearMonth.slice(5))}月`).join('・');
      const response = await createApprovalRequest({
        companyId: auth.companyId,
        employeeId,
        targetPath: santeiGradePath(auth.companyId, employeeId, input.year),
        targetVersion: 0,
        requestType: 'grade',
        comment: input.comment,
        metadata: {
          effectiveMonth: santeiEffectiveMonth(input.year),
          determinationType: 'regular',
          ...row.proposed,
          basisRemuneration: row.average,
          basisMonths: row.months.filter(m => m.used).map(m => m.yearMonth),
          previousGrade: row.current,
          reason: `${input.year}年 定時決定（${usedMonths}の平均 ${row.average!.toLocaleString()}円）`,
          source: 'santei',
        },
      }, auth);
      results.push({ employeeId, ok: true, requestId: response.id });
    } catch (e) {
      results.push({ employeeId, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { results };
}
