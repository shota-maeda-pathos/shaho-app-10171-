import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { EmployeeDoc } from '../../types/firestore';
import { MutationResponse } from '../../types/response';
import { alreadyExists, notFound } from '../../utils/errors';
import { GradeCreateInput } from './schema';

export async function createGrade(
  input: GradeCreateInput,
  auth: AuthContext,
): Promise<MutationResponse> {
  const empRef = db.doc(
    `companies/${auth.companyId}/employees/${input.employeeId}`,
  );

  const gradeDocId = input.effectiveMonth;

  const result = await db.runTransaction(async (tx) => {
    const empDoc = await tx.get(empRef);
    if (!empDoc.exists || empDoc.data()!.deletedAt !== null) {
      throw notFound('従業員');
    }
    const employee = empDoc.data()! as EmployeeDoc;

    if (!auth.roles.includes('admin')) {
      requireOffice(auth, employee.officeId);
    }

    const gradeRef = db.doc(
      `companies/${auth.companyId}/employees/${input.employeeId}/grades/${gradeDocId}`,
    );
    const existing = await tx.get(gradeRef);
    if (existing.exists) {
      throw alreadyExists('この適用月の等級');
    }

    const now = Timestamp.now();
    tx.set(gradeRef, {
      effectiveMonth: input.effectiveMonth,
      healthGradeNumber: input.healthGradeNumber,
      healthStandardRemuneration: input.healthStandardRemuneration,
      pensionGradeNumber: input.pensionGradeNumber,
      pensionStandardRemuneration: input.pensionStandardRemuneration,
      determinationType: input.determinationType,
      reason: input.reason ?? '',
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    const auditRef = db
      .collection(`companies/${auth.companyId}/auditLogs`)
      .doc();
    tx.set(auditRef, {
      entity: 'grade',
      entityId: gradeDocId,
      action: 'create',
      changes: {},
      performedBy: auth.uid,
      performedAt: now,
      version: 1,
    });

    return gradeDocId;
  });

  return { success: true, id: result };
}
