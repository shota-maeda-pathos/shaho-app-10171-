import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { notFound } from '../../utils/errors';
import { EmployeeHistoryListInput } from './schema';
const fields = {
  employments: ['effectiveDate', 'employmentType', 'weeklyHours', 'monthlyDays', 'baseSalary', 'socialInsuranceEnrolled', 'longTermCareEnrolled', 'version'],
  grades: ['effectiveMonth', 'healthGradeNumber', 'healthStandardRemuneration', 'pensionGradeNumber', 'pensionStandardRemuneration', 'determinationType', 'version'],
  bonuses: ['yearMonth', 'totalAmount', 'standardBonusAmount', 'isConfirmed', 'version'],
  salaries: ['yearMonth', 'baseSalary', 'totalFixedWage', 'totalVariableWage', 'totalSalary', 'isConfirmed', 'version'],
};
const order = { employments: 'effectiveDate', grades: 'effectiveMonth', bonuses: 'yearMonth', salaries: 'yearMonth' };
export async function listEmployeeHistory(input: EmployeeHistoryListInput, auth: AuthContext) {
  const base = `companies/${auth.companyId}/employees/${input.employeeId}`;
  const employee = await db.doc(base).get();
  if (!employee.exists || employee.data()!.deletedAt !== null) throw notFound('従業員');
  requireOffice(auth, employee.data()!.officeId);
  const path = `${base}/${input.collection}`;
  let query: FirebaseFirestore.Query = db.collection(path).orderBy(order[input.collection], 'desc');
  if (input.lastDocId) {
    const cursor = await db.doc(`${path}/${input.lastDocId}`).get();
    if (!cursor.exists) throw notFound('履歴の続き');
    query = query.startAfter(cursor);
  }
  const snapshot = await query.limit(input.limit + 1).get();
  const page = snapshot.docs.slice(0, input.limit);
  return {
    items: page.map(doc => {
      const data = doc.data();
      return { id: doc.id, ...Object.fromEntries(fields[input.collection].map(field => {
        const value = data[field];
        return [field, value?.toDate ? value.toDate().toISOString() : value ?? null];
      })) };
    }),
    hasMore: snapshot.docs.length > input.limit,
    lastDocId: page.at(-1)?.id ?? null,
  };
}
