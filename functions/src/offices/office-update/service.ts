import { OFFICE_EXTRA_KEYS } from '../../types/catalog-schemas';
import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../../config';
import { AuthContext } from '../../middleware/auth';
import { MutationResponse } from '../../types/response';
import { notFound } from '../../utils/errors';
import { OfficeUpdateInput } from './schema';

export async function updateOffice(
  input: OfficeUpdateInput,
  auth: AuthContext,
): Promise<MutationResponse> {
  const ref = db.doc(`companies/${auth.companyId}/offices/${input.officeId}`);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw notFound('事業所');
    const data = snap.data()!;
    const currentVersion = data.version ?? 1;

    if (currentVersion !== input.expectedVersion) {
      throw new HttpsError(
        'aborted',
        `版番号が一致しません（期待: ${input.expectedVersion}, 現行: ${currentVersion}）`,
      );
    }

    const updates: Record<string, unknown> = {
      version: currentVersion + 1,
      updatedAt: Timestamp.now(),
    };

    const fields = [
      'name', 'officeNumber', 'prefectureCode', 'insurerId',
      'address', 'phone', 'closingDay', 'paymentDay',
      'paymentMonth', 'deductionMethod', 'roundingRule',
      ...OFFICE_EXTRA_KEYS,
    ] as const;

    for (const f of fields) {
      if (input[f] !== undefined) updates[f] = input[f];
    }
    // 組合健保は保険者番号の料率を使うので、保険者番号を必須にする（カタログ1章）
    const type = input.healthInsuranceType !== undefined ? input.healthInsuranceType : data.healthInsuranceType;
    const insurer = input.insurerId !== undefined ? input.insurerId : data.insurerId;
    if (type === 'union' && !String(insurer ?? '').trim()) throw new HttpsError('invalid-argument', '組合健保の事業所は、保険者番号を入れてください');

    tx.update(ref, updates);
  });

  return { success: true, id: input.officeId };
}
