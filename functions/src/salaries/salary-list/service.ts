import { mapConcurrent } from '../../utils/parallel';
import { db } from '../../config';
import { AuthContext } from '../../middleware/auth';
import { SalaryListInput } from './schema';

interface SalaryListItem {
  employeeId: string;
  employeeName: string;
  yearMonth: string;
  baseSalary: number;
  totalSalary: number;
  isConfirmed: boolean;
  version: number;
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
      version: salarySnap.exists ? salarySnap.data()!.version : 0,
    };
  });

  return {
    items,
    hasMore,
    lastDocId: empDocs.length > 0 ? empDocs[empDocs.length - 1].id : undefined,
  };
}
