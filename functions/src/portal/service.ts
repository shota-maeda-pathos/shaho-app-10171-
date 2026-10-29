import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config';
import { AuthContext, requireLoginEnabled } from '../middleware/auth';
import { mapConcurrent } from '../utils/parallel';
import { notFound } from '../utils/errors';
import { PortalOverviewInput, PortalPayslipGetInput } from './schema';
import { portalAccessDeadline } from './access-period';
async function self(auth: AuthContext) {
  requireLoginEnabled(auth);
  if (!auth.employeeId) return null;
  if (auth.employeeId.includes('/')) throw new HttpsError('permission-denied', '従業員の紐付けを確認してください');
  const path = `companies/${auth.companyId}/employees/${auth.employeeId}`;
  const employee = await db.doc(path).get();
  if (!employee.exists || employee.data()!.deletedAt !== null) throw notFound('本人の従業員情報');
  const data = employee.data()!;
  if (data.userId !== auth.uid) throw new HttpsError('permission-denied', '本人の従業員情報との紐付けが一致しません');
  const deadline=portalAccessDeadline(data);
  if(deadline&&deadline.getTime()<=Date.now()) throw new HttpsError('permission-denied','退職後の本人ポータル閲覧期間が終了しています。管理者にお問い合わせください。');
  return { path, data };
}
function amount(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
function allowances(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, value]) => typeof value === 'number' && Number.isFinite(value)));
}
function insuranceResult(data: FirebaseFirestore.DocumentData | undefined) {
  if (!data || data.isConfirmed !== true) return null;
  return {
    yearMonth: data.yearMonth,
    health: amount(data.healthInsurance?.employeeAmount),
    pension: amount(data.pensionInsurance?.employeeAmount),
    longTermCare: data.longTermCareInsurance === null ? 0 : amount(data.longTermCareInsurance?.employeeAmount),
    childSupportPayment: amount(data.childSupportPayment?.employeeAmount),
    totalEmployee: amount(data.totalEmployeeAmount), isExempted: data.isExempted === true,
  };
}
async function payslip(path: string, yearMonth: string, salary: FirebaseFirestore.DocumentData) {
  // 毎月の処理で公開した明細は、控除した保険料の月（翌月控除なら前月分）を持つ。null は控除なし
  const premiumMonth = salary.deductedPremiumMonth === undefined ? yearMonth : salary.deductedPremiumMonth;
  const insurance = premiumMonth ? await db.doc(`${path}/monthlyInsurance/${premiumMonth}`).get() : null;
  return {
    yearMonth, baseSalary: amount(salary.baseSalary), totalSalary: amount(salary.totalSalary),
    fixedAllowances: allowances(salary.fixedAllowances), variableAllowances: allowances(salary.variableAllowances),
    insurance: insuranceResult(insurance?.data()),
  };
}
export async function getPortalOverview(input: PortalOverviewInput, auth: AuthContext) {
  const employee = await self(auth);
  if (!employee) return { linked: false, profile: null, payslips: [], hasMore: false, lastDocId: null };
  const { path, data } = employee;
  const company = `companies/${auth.companyId}`;
  const [office, department] = await Promise.all([
    db.doc(`${company}/offices/${data.officeId}`).get(),
    data.departmentId ? db.doc(`${company}/departments/${data.departmentId}`).get() : Promise.resolve(null),
  ]);
  let query: FirebaseFirestore.Query = db.collection(`${path}/salaries`).orderBy('yearMonth', 'desc');
  if (input.lastDocId) {
    const cursor = await db.doc(`${path}/salaries/${input.lastDocId}`).get();
    if (!cursor.exists) throw notFound('明細の続き');
    query = query.startAfter(cursor);
  }
  // Page raw months, then expose confirmed salaries only; no composite index required.
  const snapshot = await query.limit(input.limit + 1).get();
  const page = snapshot.docs.slice(0, input.limit);
  const confirmed = page.filter(doc => doc.data().isConfirmed === true && doc.data().isPublished === true && /^\d{4}-(0[1-9]|1[0-2])$/.test(doc.id));
  const items = await mapConcurrent(confirmed, 4, doc => payslip(path, doc.id, doc.data()));
  return {
    linked: true,
    profile: { employeeName: `${data.lastName} ${data.firstName}`, employeeNumber: data.employeeNumber,
      hireDate: data.hireDate?.toDate ? data.hireDate.toDate().toISOString().slice(0, 10) : null,
      officeName: office.data()?.name ?? null, departmentName: department?.data()?.name ?? null, isActive: data.isActive === true },
    payslips: items, hasMore: snapshot.docs.length > input.limit, lastDocId: page.at(-1)?.id ?? null,
  };
}
export async function getPortalPayslip(input: PortalPayslipGetInput, auth: AuthContext) {
  const employee = await self(auth);
  if (!employee) throw new HttpsError('failed-precondition', '従業員との紐付けがありません。管理者に確認してください');
  const salary = await db.doc(`${employee.path}/salaries/${input.yearMonth}`).get();
  if (!salary.exists || salary.data()!.isConfirmed !== true || salary.data()!.isPublished !== true) throw notFound('公開済みの給与情報');
  return { employeeName: `${employee.data.lastName} ${employee.data.firstName}`, ...await payslip(employee.path, input.yearMonth, salary.data()!) };
}
