import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { EmployeeDoc } from '../../types/firestore';
import { MutationResponse } from '../../types/response';
import { alreadyExists, notFound } from '../../utils/errors';
import { SalaryCreateInput } from './schema';

function sumValues(map: Record<string, number>): number {
  return Object.values(map).reduce((a, b) => a + b, 0);
}

export async function createSalary(
  input: SalaryCreateInput,
  auth: AuthContext,
): Promise<MutationResponse> {
  const empRef = db.doc(
    `companies/${auth.companyId}/employees/${input.employeeId}`,
  );

  const salaryDocId = input.yearMonth;

  const result = await db.runTransaction(async (tx) => {
    const empDoc = await tx.get(empRef);
    if (!empDoc.exists || empDoc.data()!.deletedAt !== null) {
      throw notFound('従業員');
    }
    const employee = empDoc.data()! as EmployeeDoc;

    if (!auth.roles.includes('admin')) {
      requireOffice(auth, employee.officeId);
    }

    const salaryRef = db.doc(
      `companies/${auth.companyId}/employees/${input.employeeId}/salaries/${salaryDocId}`,
    );
    const existing = await tx.get(salaryRef);
    if (existing.exists) {
      throw alreadyExists('この年月の給与データ');
    }

    const fixed = input.fixedAllowances ?? {};
    const variable = input.variableAllowances ?? {};
    const totalFixedWage = input.baseSalary + sumValues(fixed);
    const totalVariableWage = sumValues(variable);
    const totalSalary = totalFixedWage + totalVariableWage;

    const now = Timestamp.now();
    tx.set(salaryRef, {
      yearMonth: input.yearMonth,
      officeId: employee.officeId,
      paymentBasisDays: input.paymentBasisDays,
      baseSalary: input.baseSalary,
      fixedAllowances: fixed,
      variableAllowances: variable,
      totalFixedWage,
      totalVariableWage,
      totalSalary,
      isConfirmed: false,
      confirmedAt: null,
      confirmedBy: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    const auditRef = db
      .collection(`companies/${auth.companyId}/auditLogs`)
      .doc();
    tx.set(auditRef, {
      entity: 'salary',
      entityId: salaryDocId,
      action: 'create',
      changes: {},
      performedBy: auth.uid,
      performedAt: now,
      version: 1,
    });

    return salaryDocId;
  });

  return { success: true, id: result };
}
