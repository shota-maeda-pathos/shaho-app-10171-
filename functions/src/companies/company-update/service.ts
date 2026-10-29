import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../../config';
import { AuthContext } from '../../middleware/auth';
import { MutationResponse } from '../../types/response';
import { CompanyUpdateInput } from './schema';

export async function updateCompany(
  input: CompanyUpdateInput,
  auth: AuthContext,
): Promise<MutationResponse> {
  const ref = db.doc(`companies/${auth.companyId}`);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data() ?? {};
    const currentVersion = data.version ?? 1;

    if (snap.exists && currentVersion !== input.expectedVersion) {
      throw new HttpsError(
        'aborted',
        `版番号が一致しません（期待: ${input.expectedVersion}, 現行: ${currentVersion}）`,
      );
    }

    const updates: Record<string, unknown> = {
      version: currentVersion + 1,
      updatedAt: Timestamp.now(),
      updatedBy: auth.uid,
    };

    const fields = [
      'name', 'corporateNumber', 'representativeName',
      'address', 'phone', 'email',
      'healthInsurerId', 'pensionCode',
    ] as const;

    for (const f of fields) {
      if (input[f] !== undefined) updates[f] = input[f];
    }

    tx.set(ref, updates, { merge: true });
  });

  return { success: true, id: auth.companyId };
}
