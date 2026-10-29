import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { EmployeeDoc } from '../../types/firestore';
import { notFound } from '../../utils/errors';
import { SecretsGetInput, SecretsUpdateInput } from './schema';

export interface SecretsResponse {
  myNumber: string | null;
  basicPensionNumber: string | null;
  version: number;
}

export async function getSecrets(
  input: SecretsGetInput,
  auth: AuthContext,
): Promise<SecretsResponse> {
  const base = `companies/${auth.companyId}`;
  const empSnap = await db.doc(`${base}/employees/${input.employeeId}`).get();
  if (!empSnap.exists || (empSnap.data() as EmployeeDoc).deletedAt !== null) {
    throw notFound('従業員');
  }
  if (!auth.roles.includes('admin')) {
    requireOffice(auth, (empSnap.data() as EmployeeDoc).officeId);
  }

  const secretSnap = await db.doc(`${base}/employees/${input.employeeId}/secrets/main`).get();
  if (!secretSnap.exists) {
    return { myNumber: null, basicPensionNumber: null, version: 0 };
  }
  const data = secretSnap.data()!;
  return {
    myNumber: data.myNumber ?? null,
    basicPensionNumber: data.basicPensionNumber ?? null,
    version: data.version ?? 1,
  };
}

export async function updateSecrets(
  input: SecretsUpdateInput,
  auth: AuthContext,
): Promise<{ success: boolean }> {
  const base = `companies/${auth.companyId}`;
  const empRef = db.doc(`${base}/employees/${input.employeeId}`);
  const secretRef = db.doc(`${base}/employees/${input.employeeId}/secrets/main`);

  await db.runTransaction(async (tx) => {
    const empSnap = await tx.get(empRef);
    if (!empSnap.exists || (empSnap.data() as EmployeeDoc).deletedAt !== null) {
      throw notFound('従業員');
    }
    if (!auth.roles.includes('admin')) {
      requireOffice(auth, (empSnap.data() as EmployeeDoc).officeId);
    }

    const secretSnap = await tx.get(secretRef);
    const currentVersion = secretSnap.exists ? (secretSnap.data()!.version ?? 1) : 0;

    if (currentVersion !== input.expectedVersion) {
      throw new HttpsError(
        'failed-precondition',
        `データが更新されています（現在のバージョン: ${currentVersion}）`,
      );
    }

    const now = Timestamp.now();
    const updateData: Record<string, unknown> = {
      version: currentVersion + 1,
      updatedAt: now,
      updatedBy: auth.uid,
    };
    if (input.myNumber !== undefined) updateData.myNumber = input.myNumber;
    if (input.basicPensionNumber !== undefined) updateData.basicPensionNumber = input.basicPensionNumber;

    if (secretSnap.exists) {
      tx.update(secretRef, updateData);
    } else {
      tx.set(secretRef, { ...updateData, createdAt: now });
    }

    const auditRef = db.collection(`${base}/auditLogs`).doc();
    tx.set(auditRef, {
      entity: 'employee',
      entityId: input.employeeId,
      action: 'update',
      changes: { secrets: { from: 'redacted', to: 'redacted' } },
      performedBy: auth.uid,
      performedAt: now,
      version: currentVersion + 1,
    });
  });

  return { success: true };
}
