import { db } from '../../config';
import type { AuthContext } from '../../middleware/auth';
import type { InsuranceRateDoc } from '../../types/firestore';
import type { InsuranceRateResponse } from '../../types/response';
import { toISOString } from '../../utils/firestore';
import type { InsuranceRateListInput } from './schema';

function toInsuranceRateResponse(
  id: string,
  data: InsuranceRateDoc,
): InsuranceRateResponse {
  return {
    id,
    insuranceType: data.insuranceType,
    insurerId: data.insurerId,
    prefectureCode: data.prefectureCode ?? '',
    appliedFrom: data.appliedFrom,
    appliedUntil: data.appliedUntil ?? null,
    totalRate: data.totalRate,
    employeeRate: data.employeeRate,
    employerRate: data.employerRate,
    gradeTable: data.gradeTable ?? null,
    note: data.note ?? '',
    createdAt: toISOString(data.createdAt),
    updatedAt: toISOString(data.updatedAt),
  };
}

export async function listInsuranceRates(
  input: InsuranceRateListInput,
  auth: AuthContext,
): Promise<{ items: InsuranceRateResponse[] }> {
  const collRef = db.collection(
    `companies/${auth.companyId}/insuranceRates`,
  );

  let query: FirebaseFirestore.Query = collRef.orderBy('appliedFrom', 'desc');

  if (input.insuranceType) {
    query = query.where('insuranceType', '==', input.insuranceType);
  }

  if (input.insurerId) {
    query = query.where('insurerId', '==', input.insurerId);
  }

  if (input.prefectureCode) {
    query = query.where('prefectureCode', '==', input.prefectureCode);
  }

  if (input.currentOnly ?? true) {
    query = query.where('appliedUntil', '==', null);
  }

  const snap = await query.get();
  const items = snap.docs.map((d) =>
    toInsuranceRateResponse(d.id, d.data() as InsuranceRateDoc),
  );

  return { items };
}
