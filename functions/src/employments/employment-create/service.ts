import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { EmployeeDoc } from '../../types/firestore';
import { MutationResponse } from '../../types/response';
import { notFound } from '../../utils/errors';
import { EmploymentCreateInput } from './schema';

export async function createEmployment(
  input: EmploymentCreateInput,
  auth: AuthContext,
): Promise<MutationResponse> {
  const empRef = db.doc(
    `companies/${auth.companyId}/employees/${input.employeeId}`,
  );

  const result = await db.runTransaction(async (tx) => {
    const empDoc = await tx.get(empRef);
    if (!empDoc.exists || empDoc.data()!.deletedAt !== null) {
      throw notFound('従業員');
    }
    const employee = empDoc.data()! as EmployeeDoc;

    if (!auth.roles.includes('admin')) {
      requireOffice(auth, employee.officeId);
    }

    const now = Timestamp.now();
    const docRef = db
      .collection(
        `companies/${auth.companyId}/employees/${input.employeeId}/employments`,
      )
      .doc();

    tx.set(docRef, {
      effectiveDate: input.effectiveDate,
      employmentType: input.employmentType,
      weeklyHours: input.weeklyHours,
      monthlyDays: input.monthlyDays,
      baseSalary: input.baseSalary,
      socialInsuranceEnrolled: input.socialInsuranceEnrolled,
      longTermCareEnrolled: input.longTermCareEnrolled,
      note: input.note ?? '',
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    const auditRef = db
      .collection(`companies/${auth.companyId}/auditLogs`)
      .doc();
    tx.set(auditRef, {
      entity: 'employment',
      entityId: docRef.id,
      action: 'create',
      changes: {},
      performedBy: auth.uid,
      performedAt: now,
      version: 1,
    });

    return docRef.id;
  });

  return { success: true, id: result };
}
