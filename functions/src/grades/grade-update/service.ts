import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { EmployeeDoc, GradeDoc } from '../../types/firestore';
import { MutationResponse } from '../../types/response';
import { notFound } from '../../utils/errors';
import { GradeUpdateInput } from './schema';

const MUTABLE_FIELDS = [
  'healthGradeNumber',
  'healthStandardRemuneration',
  'pensionGradeNumber',
  'pensionStandardRemuneration',
  'determinationType',
  'reason',
] as const;

export async function updateGrade(
  input: GradeUpdateInput,
  auth: AuthContext,
): Promise<MutationResponse> {
  const gradeRef = db.doc(
    `companies/${auth.companyId}/employees/${input.employeeId}/grades/${input.gradeId}`,
  );

  await db.runTransaction(async (tx) => {
    const empRef = db.doc(
      `companies/${auth.companyId}/employees/${input.employeeId}`,
    );
    const empDoc = await tx.get(empRef);
    if (!empDoc.exists || empDoc.data()!.deletedAt !== null) {
      throw notFound('従業員');
    }
    const employee = empDoc.data()! as EmployeeDoc;

    if (!auth.roles.includes('admin')) {
      requireOffice(auth, employee.officeId);
    }

    const gradeDoc = await tx.get(gradeRef);
    if (!gradeDoc.exists) {
      throw notFound('等級');
    }
    const current = gradeDoc.data()! as GradeDoc;

    if (current.version !== input.expectedVersion) {
      throw new HttpsError(
        'failed-precondition',
        `データが更新されています（現在のバージョン: ${current.version}）`,
      );
    }

    const now = Timestamp.now();
    const updateData: Record<string, unknown> = {
      updatedAt: now,
      version: current.version + 1,
    };
    const changes: Record<string, { from: unknown; to: unknown }> = {};

    for (const key of MUTABLE_FIELDS) {
      const value = input[key as keyof GradeUpdateInput];
      if (value === undefined) continue;
      const oldValue = current[key as keyof GradeDoc];
      updateData[key] = value;
      changes[key] = { from: oldValue, to: value };
    }

    tx.update(gradeRef, updateData);

    if (Object.keys(changes).length > 0) {
      const auditRef = db
        .collection(`companies/${auth.companyId}/auditLogs`)
        .doc();
      tx.set(auditRef, {
        entity: 'grade',
        entityId: input.gradeId,
        action: 'update',
        changes,
        performedBy: auth.uid,
        performedAt: now,
        version: current.version + 1,
      });
    }
  });

  return { success: true, id: input.gradeId };
}
