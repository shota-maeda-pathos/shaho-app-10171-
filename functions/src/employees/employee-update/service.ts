import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { EmployeeDoc } from '../../types/firestore';
import { MutationResponse } from '../../types/response';
import { notFound } from '../../utils/errors';
import { toTimestamp } from '../../utils/firestore';
import { EmployeeUpdateInput } from './schema';
import { EMPLOYEE_PROFILE_KEYS } from '../../types/catalog-schemas';
import { assertDepartment } from '../../offices/departments';

const MUTABLE_FIELDS = [
  'lastName',
  'firstName',
  'lastNameKana',
  'firstNameKana',
  'gender',
  'departmentId',
  ...EMPLOYEE_PROFILE_KEYS,
] as const;

const DATE_FIELDS = ['birthDate', 'hireDate'] as const;

export async function updateEmployee(
  input: EmployeeUpdateInput,
  auth: AuthContext,
): Promise<MutationResponse> {
  const docRef = db.doc(
    `companies/${auth.companyId}/employees/${input.employeeId}`,
  );

  await db.runTransaction(async (tx) => {
    const doc = await tx.get(docRef);
    if (!doc.exists || doc.data()!.deletedAt !== null) {
      throw notFound('従業員');
    }
    const current = doc.data()! as EmployeeDoc;

    if (current.version !== input.expectedVersion) {
      throw new HttpsError(
        'failed-precondition',
        `データが更新されています（現在のバージョン: ${current.version}）`,
      );
    }

    if (!auth.roles.includes('admin')) {
      requireOffice(auth, current.officeId);
    }
    // 所属部署は同じ事業所の、使っている部署だけ（カタログ1章 部署の管理）
    if (input.departmentId && input.departmentId !== current.departmentId) await assertDepartment(auth.companyId, input.departmentId, current.officeId);

    const now = Timestamp.now();
    const updateData: Record<string, unknown> = {
      updatedAt: now,
      version: current.version + 1,
    };
    const changes: Record<string, { from: unknown; to: unknown }> = {};

    for (const key of MUTABLE_FIELDS) {
      const value = input[key as keyof EmployeeUpdateInput];
      if (value === undefined) continue;
      const oldValue = current[key as keyof EmployeeDoc];
      updateData[key] = value;
      // 変わった項目だけを記録する。まだ入っていない項目は null（Firestore は undefined を書けない）
      if (JSON.stringify(oldValue ?? null) !== JSON.stringify(value ?? null)) changes[key] = { from: oldValue ?? null, to: value ?? null };
    }

    for (const key of DATE_FIELDS) {
      const value = input[key as keyof EmployeeUpdateInput] as
        | string
        | undefined;
      if (value === undefined) continue;
      const oldValue = current[key as keyof EmployeeDoc];
      updateData[key] = toTimestamp(value);
      const before = (oldValue as { toDate?: () => Date } | null | undefined)?.toDate?.().toISOString().slice(0, 10) ?? null;
      if (before !== value.slice(0, 10)) changes[key] = { from: before, to: value };
    }

    tx.update(docRef, updateData);

    if (Object.keys(changes).length > 0) {
      const auditRef = db
        .collection(`companies/${auth.companyId}/auditLogs`)
        .doc();
      tx.set(auditRef, {
        entity: 'employee',
        entityId: input.employeeId,
        action: 'update',
        changes,
        performedBy: auth.uid,
        performedAt: now,
        version: current.version + 1,
      });
    }
  });

  return { success: true, id: input.employeeId };
}
