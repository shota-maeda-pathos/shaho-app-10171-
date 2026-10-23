import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext } from '../../middleware/auth';
import { DependentDoc } from '../../types/firestore';
import { MutationResponse } from '../../types/response';
import { notFound } from '../../utils/errors';
import { toTimestamp } from '../../utils/firestore';
import { DependentUpdateInput } from './schema';

const SIMPLE_FIELDS = [
  'lastName',
  'firstName',
  'lastNameKana',
  'firstNameKana',
  'gender',
  'relationship',
  'isDisabled',
  'income',
  'coResident',
] as const;

const DATE_FIELDS = ['birthDate', 'qualificationDate'] as const;

export async function updateDependent(
  input: DependentUpdateInput,
  auth: AuthContext,
): Promise<MutationResponse> {
  const docRef = db.doc(
    `companies/${auth.companyId}/employees/${input.employeeId}/dependents/${input.dependentId}`,
  );

  await db.runTransaction(async (tx) => {
    const doc = await tx.get(docRef);
    if (!doc.exists || doc.data()!.deletedAt !== null) {
      throw notFound('扶養家族');
    }
    const current = doc.data()! as DependentDoc;

    const now = Timestamp.now();
    const updateData: Record<string, unknown> = { updatedAt: now };
    const changes: Record<string, { from: unknown; to: unknown }> = {};

    for (const key of SIMPLE_FIELDS) {
      const value = input[key as keyof DependentUpdateInput];
      if (value === undefined) continue;
      const oldValue = current[key as keyof DependentDoc];
      updateData[key] = value;
      changes[key] = { from: oldValue, to: value };
    }

    for (const key of DATE_FIELDS) {
      const value = input[key as keyof DependentUpdateInput] as
        | string
        | undefined;
      if (value === undefined) continue;
      const oldValue = current[key as keyof DependentDoc];
      updateData[key] = toTimestamp(value);
      changes[key] = { from: oldValue, to: value };
    }

    if (input.disqualificationDate !== undefined) {
      const oldValue = current.disqualificationDate;
      const newValue = input.disqualificationDate;
      updateData.disqualificationDate = newValue
        ? toTimestamp(newValue)
        : null;
      changes.disqualificationDate = { from: oldValue, to: newValue };
    }

    tx.update(docRef, updateData);

    if (Object.keys(changes).length > 0) {
      const auditRef = db
        .collection(`companies/${auth.companyId}/auditLogs`)
        .doc();
      tx.set(auditRef, {
        entity: 'dependent',
        entityId: input.dependentId,
        action: 'update',
        changes,
        performedBy: auth.uid,
        performedAt: now,
        version: 1,
      });
    }
  });

  return { success: true, id: input.dependentId };
}
