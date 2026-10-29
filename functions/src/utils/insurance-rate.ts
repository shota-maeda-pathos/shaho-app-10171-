import { db } from '../config';
import { InsuranceRateDoc } from '../types/firestore';
import { invalidArg } from './errors';

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
  if (best) assertRateUnit(best.rate);
  return best?.rate ?? null;
}

/**
 * 料率は ‰（1000分の1。例：健康保険 99.1）で登録する。0より大きく1未満の値は、小数（0.0991）や％の誤りとみなして計算を止める。
 * 単位を誤った料率で計算すると、保険料がほぼ0円になっても気づけないため。
 */
export function assertRateUnit(rate: Pick<InsuranceRateDoc, 'insuranceType' | 'appliedFrom' | 'employeeRate' | 'employerRate' | 'totalRate'>): void {
  const values = [rate.employeeRate, rate.employerRate, rate.totalRate].filter((v): v is number => typeof v === 'number');
  if (values.some(v => v > 0 && v < 1)) {
    throw invalidArg(`料率の単位が正しくありません（${RATE_LABELS[rate.insuranceType] ?? rate.insuranceType}・${rate.appliedFrom}から：${values.join('／')}）。料率マスタは‰（例：健康保険 99.1）で登録してください`);
  }
}

const RATE_LABELS: Record<string, string> = {
  health: '健康保険', pension: '厚生年金', longTermCare: '介護保険', childSupport: '子ども・子育て拠出金', childSupportPayment: '子ども・子育て支援金',
};

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

/** 計算に使った料率を表す文字列。計算後に料率マスタが変わったか（計算し直しが要るか）を見分ける */
export function rateFingerprint(rates: AllRates): string {
  return (['health', 'pension', 'longTermCare', 'childSupport', 'childSupportPayment'] as const)
    .map(k => { const r = rates[k]; return r ? `${k}:${r.appliedFrom}:${r.employeeRate}/${r.employerRate}/${r.totalRate ?? ''}` : `${k}:-`; })
    .join('|');
}
