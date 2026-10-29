import { InsuranceRateDoc, InsurancePremiumBreakdown } from '../types/firestore';
import { invalidArg } from './errors';
import { RoundingRule, splitPremium } from '../insurance/calculator/rounding';

// Separate from childSupportContribution (事業主のみの拠出金). Rates use per-mille.
// Official FY2026 source: https://www.kyoukaikenpo.or.jp/about/business/insurance_rate/003/index.html
export function calculateChildSupportPayment(
  base: number,
  yearMonth: string,
  excluded: boolean,
  roundingRule: RoundingRule,
  configuredRate?: Pick<InsuranceRateDoc, 'employeeRate' | 'employerRate'> | null,
): InsurancePremiumBreakdown {
  if (yearMonth < '2026-04' || excluded) return { employeeAmount: 0, employerAmount: 0 };
  // Do not silently carry FY2026's statutory rate into later fiscal years.
  const rate = configuredRate ?? (yearMonth <= '2027-03' ? { employeeRate: 1.15, employerRate: 1.15 } : null);
  if (!rate) throw invalidArg('対象年度の子ども・子育て支援金率が設定されていません');
  if (![rate.employeeRate, rate.employerRate].every(r => Number.isFinite(r) && r >= 0 && r <= 1000)) {
    throw invalidArg('子ども・子育て支援金率を確認してください（単位：‰）');
  }
  return splitPremium(base, rate.employeeRate, rate.employerRate, roundingRule);
}
