import { db } from '../config';
import { InsuranceRateDoc } from '../types/firestore';

export interface RateQuery {
  companyId: string;
  insuranceType: 'health' | 'pension' | 'childSupport' | 'childSupportPayment' | 'longTermCare';
  yearMonth: string;
  prefectureCode?: string;
  insurerId?: string;
}

/**
 * 対象年月に適用される料率を検索する。
 * appliedFrom <= yearMonth かつ (appliedUntil が null または yearMonth <= appliedUntil)
 * 都道府県・保険者IDでの絞り込みも行う。
 */
export async function findApplicableRate(
  query: RateQuery,
): Promise<InsuranceRateDoc | null> {
  const base = `companies/${query.companyId}/insuranceRates`;

  // appliedFrom <= yearMonth の中で最新のものを取得
  let q: FirebaseFirestore.Query = db
    .collection(base)
    .where('insuranceType', '==', query.insuranceType)
    .where('appliedFrom', '<=', query.yearMonth)
    .orderBy('appliedFrom', 'desc');

  if (query.prefectureCode) {
    q = q.where('prefectureCode', '==', query.prefectureCode);
  }
  if (query.insurerId) {
    q = q.where('insurerId', '==', query.insurerId);
  }

  const snap = await q.limit(5).get();

  for (const doc of snap.docs) {
    const rate = doc.data() as InsuranceRateDoc;
    if (rate.appliedUntil === null || query.yearMonth <= rate.appliedUntil) {
      return rate;
    }
  }

  // フォールバック: 都道府県・保険者の絞り込みなしで再検索
  if (query.prefectureCode || query.insurerId) {
    const fallbackSnap = await db
      .collection(base)
      .where('insuranceType', '==', query.insuranceType)
      .where('appliedFrom', '<=', query.yearMonth)
      .orderBy('appliedFrom', 'desc')
      .limit(5)
      .get();

    for (const doc of fallbackSnap.docs) {
      const rate = doc.data() as InsuranceRateDoc;
      if (rate.appliedUntil === null || query.yearMonth <= rate.appliedUntil) {
        return rate;
      }
    }
  }

  return null;
}

export interface AllRates {
  health: InsuranceRateDoc | null;
  pension: InsuranceRateDoc | null;
  childSupport: InsuranceRateDoc | null;
  childSupportPayment: InsuranceRateDoc | null;
  longTermCare: InsuranceRateDoc | null;
}

export async function findAllRates(
  companyId: string,
  yearMonth: string,
  prefectureCode?: string,
  insurerId?: string,
): Promise<AllRates> {
  const base = { companyId, yearMonth, prefectureCode, insurerId };
  const [health, pension, childSupport, longTermCare, childSupportPayment] = await Promise.all([
    findApplicableRate({ ...base, insuranceType: 'health' }),
    findApplicableRate({ ...base, insuranceType: 'pension' }),
    findApplicableRate({ ...base, insuranceType: 'childSupport' }),
    findApplicableRate({ ...base, insuranceType: 'longTermCare' }),
    findApplicableRate({ companyId, yearMonth, insuranceType: 'childSupportPayment' }),
  ]);

  return { health, pension, childSupport, longTermCare, childSupportPayment };
}
