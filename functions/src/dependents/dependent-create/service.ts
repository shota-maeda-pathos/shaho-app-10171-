import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext } from '../../middleware/auth';
import { MutationResponse } from '../../types/response';
import { toTimestamp } from '../../utils/firestore';
import { DependentCreateInput } from './schema';

export async function createDependent(
  input: DependentCreateInput,
  auth: AuthContext,
): Promise<MutationResponse> {
  const now = Timestamp.now();
  const collRef = db.collection(
    `companies/${auth.companyId}/employees/${input.employeeId}/dependents`,
  );
  const docRef = collRef.doc();

  await db.runTransaction(async (tx) => {
    tx.set(docRef, {
      lastName: input.lastName,
      firstName: input.firstName,
      lastNameKana: input.lastNameKana,
      firstNameKana: input.firstNameKana,
      birthDate: toTimestamp(input.birthDate),
      gender: input.gender,
      relationship: input.relationship,
      isDisabled: input.isDisabled ?? false,
      income: input.income ?? 0,
      coResident: input.coResident ?? true,
      qualificationDate: toTimestamp(input.qualificationDate),
      disqualificationDate: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    const auditRef = db
      .collection(`companies/${auth.companyId}/auditLogs`)
      .doc();
    tx.set(auditRef, {
      entity: 'dependent',
      entityId: docRef.id,
      action: 'create',
      changes: {},
      performedBy: auth.uid,
      performedAt: now,
      version: 1,
    });
  });

  return { success: true, id: docRef.id };
}
