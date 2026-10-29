import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { notFound } from '../../utils/errors';
import { MonthlyInsuranceGetInput } from './schema';
export async function getMonthlyInsurance(input: MonthlyInsuranceGetInput, auth: AuthContext) {
  const base = `companies/${auth.companyId}/employees/${input.employeeId}`;
  const employee = await db.doc(base).get();
  if (!employee.exists || employee.data()!.deletedAt !== null) throw notFound('従業員');
  requireOffice(auth, employee.data()!.officeId);
  const snapshot = await db.doc(`${base}/monthlyInsurance/${input.yearMonth}`).get();
  if (!snapshot.exists) return { insurance: null };
  const d = snapshot.data()!;
  return { insurance: {
    yearMonth: d.yearMonth, version: d.version,
    healthGradeNumber: d.healthGradeNumber, pensionGradeNumber: d.pensionGradeNumber,
    healthEmployee: d.healthInsurance.employeeAmount, pensionEmployee: d.pensionInsurance.employeeAmount,
    totalEmployee: d.totalEmployeeAmount, totalEmployer: d.totalEmployerAmount,
    isExempted: d.isExempted === true, isConfirmed: d.isConfirmed === true, approvalPending: d.approvalPending === true,
  } };
}
