import { db } from '../../config';
import type { AuthContext } from '../../middleware/auth';
import type { InsuranceRateDoc } from '../../types/firestore';
import type { InsuranceRateResponse } from '../../types/response';
import type { InsuranceRateListInput } from './schema';

/** シードや手作業で入れた料率には日時がない・文字列のものがあるため、変換で落とさない */
function safeISO(value: unknown): string {
  if (value && typeof (value as { toDate?: unknown }).toDate === 'function') return (value as { toDate: () => Date }).toDate().toISOString();
  return typeof value === 'string' ? value : '';
}

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
    createdAt: safeISO(data.createdAt),
    updatedAt: safeISO(data.updatedAt),
  };
}

export async function listInsuranceRates(
  input: InsuranceRateListInput,
  auth: AuthContext,
): Promise<{ items: InsuranceRateResponse[] }> {
  // 料率マスタは件数が少ないため、保険種別だけで取得して（既存の索引）、残りの条件と並べ替えはここで行う。
  // 条件を Firestore で組み合わせると複合索引が要り、本番で INTERNAL になっていた
  const collRef = db.collection(`companies/${auth.companyId}/insuranceRates`);
  const query: FirebaseFirestore.Query = input.insuranceType ? collRef.where('insuranceType', '==', input.insuranceType) : collRef;
  const snap = await query.get();
  const docs = snap.docs
    .filter((d) => {
      const r = d.data() as InsuranceRateDoc;
      if (input.insurerId && r.insurerId !== input.insurerId) return false;
      if (input.prefectureCode && (r.prefectureCode ?? '') !== input.prefectureCode) return false;
      if ((input.currentOnly ?? true) && (r.appliedUntil ?? null) !== null) return false;
      return true;
    })
    .sort((a, b) => String(b.data().appliedFrom).localeCompare(String(a.data().appliedFrom)));

  const items = docs.map((d) =>
    toInsuranceRateResponse(d.id, d.data() as InsuranceRateDoc),
  );

  return { items };
}
