import { mapConcurrent } from '../../utils/parallel';
import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { notFound } from '../../utils/errors';
import { SalaryListInput } from './schema';

interface SalaryDetail {
  exists: boolean;
  paymentBasisDays: number;
  fixedAllowances: Record<string, number>;
  variableAllowances: Record<string, number>;
  inKindAmount: number;
  retroactivePay: { amount: number; fromMonth: string; toMonth: string } | null;
  noPay: boolean;
}

interface SalaryListItem {
  employeeId: string;
  employeeName: string;
  yearMonth: string;
  baseSalary: number;
  totalSalary: number;
  isConfirmed: boolean;
  approvalPending:boolean;
  isPublished:boolean;
  version: number;
  detail?: SalaryDetail;
}

export interface SalaryListResponse {
  items: SalaryListItem[];
  hasMore: boolean;
  lastDocId?: string;
}

export async function listSalaries(
  input: SalaryListInput,
  auth: AuthContext,
): Promise<SalaryListResponse> {
  if(input.officeId) requireOffice(auth,input.officeId);
  if (input.employeeId) return { items: [await salaryOf(input.employeeId, input.yearMonth, auth)], hasMore: false };
  if (!auth.roles.includes('admin') && auth.officeIds.length === 0) return { items: [], hasMore: false };
  let empQuery: FirebaseFirestore.Query = db
    .collection(`companies/${auth.companyId}/employees`)
    .where('deletedAt', '==', null)
    .where('isActive', '==', true)
    .orderBy('employeeNumber', 'asc');

  if (!auth.roles.includes('admin') && auth.officeIds.length > 0) {
    empQuery = empQuery.where('officeId', 'in', auth.officeIds);
  }
  if (input.officeId) {
    empQuery = empQuery.where('officeId', '==', input.officeId);
  }

  const effectiveLimit = input.limit ?? 20;

  if (input.lastDocId) {
    const lastDoc = await db
      .doc(`companies/${auth.companyId}/employees/${input.lastDocId}`)
      .get();
    if (lastDoc.exists) {
      empQuery = empQuery.startAfter(lastDoc);
    }
  }

  empQuery = empQuery.limit(effectiveLimit + 1);
  const empSnap = await empQuery.get();
  const hasMore = empSnap.docs.length > effectiveLimit;
  const empDocs = hasMore ? empSnap.docs.slice(0, effectiveLimit) : empSnap.docs;

  const items = await mapConcurrent(empDocs, 8, async (empDoc): Promise<SalaryListItem> => {
    const empData = empDoc.data();
    const salaryRef = db.doc(
      `companies/${auth.companyId}/employees/${empDoc.id}/salaries/${input.yearMonth}`,
    );
    const salarySnap = await salaryRef.get();

    return {
      employeeId: empDoc.id,
      employeeName: `${empData.lastName} ${empData.firstName}`,
      yearMonth: input.yearMonth,
      baseSalary: salarySnap.exists ? salarySnap.data()!.baseSalary : 0,
      totalSalary: salarySnap.exists ? salarySnap.data()!.totalSalary : 0,
      isConfirmed: salarySnap.exists ? salarySnap.data()!.isConfirmed : false,
      approvalPending:salarySnap.data()?.approvalPending===true,
      isPublished:salarySnap.data()?.isPublished===true,
      version: salarySnap.exists ? salarySnap.data()!.version : 0,
    };
  });

  return {
    items,
    hasMore,
    lastDocId: empDocs.length > 0 ? empDocs[empDocs.length - 1].id : undefined,
  };
}

/** 1人分の給与の詳細。入力画面で手当や遡及差額まで読み込むために使う */
async function salaryOf(employeeId: string, yearMonth: string, auth: AuthContext): Promise<SalaryListItem> {
  const base = `companies/${auth.companyId}/employees/${employeeId}`;
  const [employee, salary] = await Promise.all([db.doc(base).get(), db.doc(`${base}/salaries/${yearMonth}`).get()]);
  if (!employee.exists || employee.data()!.deletedAt != null) throw notFound('従業員');
  requireOffice(auth, employee.data()!.officeId);
  const e = employee.data()!;
  const s = salary.data();
  return {
    employeeId, employeeName: `${e.lastName} ${e.firstName}`, yearMonth,
    baseSalary: s?.baseSalary ?? 0, totalSalary: s?.totalSalary ?? 0, isConfirmed: s?.isConfirmed === true,
    approvalPending: s?.approvalPending === true, isPublished: s?.isPublished === true, version: s?.version ?? 0,
    detail: {
      exists: salary.exists, paymentBasisDays: s?.paymentBasisDays ?? 0,
      fixedAllowances: s?.fixedAllowances ?? {}, variableAllowances: s?.variableAllowances ?? {},
      inKindAmount: s?.inKindAmount ?? 0, retroactivePay: s?.retroactivePay ?? null, noPay: s?.noPay === true,
    },
  };
}
