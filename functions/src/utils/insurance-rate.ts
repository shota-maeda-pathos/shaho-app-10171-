import { db } from '../config';
import { InsuranceRateDoc } from '../types/firestore';

export interface RateQuery {
  companyId: string;
  insuranceType: 'health' | 'pension' | 'childSupport' | 'childSupportPayment' | 'longTermCare';
  yearMonth: string;
  prefectureCode?: string;
  insurerId?: string;
}

/** 全国一律の料率（都道府県・保険者で変わらない） */
const NATIONAL_TYPES: RateQuery['insuranceType'][] = ['pension', 'childSupport', 'childSupportPayment'];

/**
 * 料率がこの事業所に使えるか。使える場合は優先度（大きいほど優先）を返す。
 * - 都道府県が設定された料率（協会けんぽ）は、事業所の都道府県と一致する場合だけ使う。別の都道府県の料率は使わない
 * - 都道府県のない料率は、保険者が一致するもの（組合健保）か、保険者の指定がないもの（全国一律）だけ使う
 * - 保険者まで一致するものを優先する
 */
export function rateMatchScore(rate: Pick<InsuranceRateDoc, 'prefectureCode' | 'insurerId'>, query: Pick<RateQuery, 'insuranceType' | 'prefectureCode' | 'insurerId'>): number | null {
  if (NATIONAL_TYPES.includes(query.insuranceType)) return 0;
  const ratePref = rate.prefectureCode || '';
  const rateInsurer = rate.insurerId || '';
  const insurerMatches = !!query.insurerId && rateInsurer === query.insurerId;
  if (ratePref) {
    if (!query.prefectureCode || ratePref !== query.prefectureCode) return null;
    return insurerMatches ? 3 : 2;
  }
  if (insurerMatches) return 3;
  if (!rateInsurer || rateInsurer === 'kyokai') return 1;
  return null;
}

/**
 * 対象年月に適用される料率を検索する。
 * appliedFrom <= yearMonth かつ (appliedUntil が null または yearMonth <= appliedUntil)。
 * 料率マスタは件数が少ないため、保険種別と適用開始月だけで取得し（既存の索引を使う）、
 * 都道府県・保険者の当てはめはここで行う。
 */
export async function findApplicableRate(
  query: RateQuery,
): Promise<InsuranceRateDoc | null> {
  const snap = await db
    .collection(`companies/${query.companyId}/insuranceRates`)
    .where('insuranceType', '==', query.insuranceType)
    .where('appliedFrom', '<=', query.yearMonth)
    .orderBy('appliedFrom', 'desc')
    .limit(500)
    .get();

  let best: { rate: InsuranceRateDoc; score: number } | null = null;
  for (const doc of snap.docs) {
    const rate = doc.data() as InsuranceRateDoc;
    if (rate.appliedUntil && query.yearMonth > rate.appliedUntil) continue;
    const score = rateMatchScore(rate, query);
    if (score === null) continue;
    // 適用開始月の新しい順に並んでいるので、同じ優先度なら先に見つかったもの（最新）を使う
    if (!best || score > best.score) best = { rate, score };
  }
  return best?.rate ?? null;
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
