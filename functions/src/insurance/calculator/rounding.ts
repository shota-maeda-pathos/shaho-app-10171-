import { InsurancePremiumBreakdown } from '../../types/firestore';

/**
 * 被保険者負担分の端数処理。
 * - statutory: 50銭以下切捨て・50銭超切上げ（給与から控除する場合の法定ルール。既定）
 * - round:     50銭未満切捨て・50銭以上切上げ（現金で納める場合のルール／労使協定）
 * - truncate:  切捨て（労使協定）
 * - ceil:      切上げ（労使協定）
 */
export type RoundingRule = 'statutory' | 'round' | 'truncate' | 'ceil';

export const DEFAULT_ROUNDING_RULE: RoundingRule = 'statutory';

const MICRO = 1_000_000;

// 料率（‰）を小数第3位までの整数に直す。浮動小数の誤差を計算に持ち込まない
function toMilliPermille(rate: number): number {
  return Math.round(rate * 1000);
}

/** base(円) × rate(‰) を 1/1,000,000 円単位の整数で返す */
function microYen(base: number, rate: number): number {
  return base * toMilliPermille(rate);
}

export function roundEmployeeShare(micro: number, rule: RoundingRule): number {
  const yen = Math.floor(micro / MICRO);
  const fraction = micro - yen * MICRO;
  switch (rule) {
    case 'statutory': return fraction > MICRO / 2 ? yen + 1 : yen;
    case 'round': return fraction >= MICRO / 2 ? yen + 1 : yen;
    case 'ceil': return fraction > 0 ? yen + 1 : yen;
    case 'truncate': return yen;
  }
}

/**
 * 保険料を本人負担と会社負担に分ける。
 * 本人負担 = 標準報酬 × 本人料率（端数処理ルールを適用）
 * 会社負担 = 保険料全額（円未満切捨て）− 本人負担
 * totalRate を省略した場合は本人料率＋会社料率を全額の料率とする。
 */
export function splitPremium(
  base: number,
  employeeRate: number,
  employerRate: number,
  rule: RoundingRule,
  totalRate?: number,
): InsurancePremiumBreakdown {
  if (!Number.isInteger(base) || base < 0) throw new RangeError('標準報酬額は0以上の整数で指定してください');
  const total = totalRate ?? employeeRate + employerRate;
  const totalYen = Math.floor(microYen(base, total) / MICRO);
  const employeeAmount = roundEmployeeShare(microYen(base, employeeRate), rule);
  return { employeeAmount, employerAmount: Math.max(totalYen - employeeAmount, 0) };
}

/** 事業主のみが負担する拠出金（子ども・子育て拠出金など）。円未満切捨て */
export function employerOnlyPremium(base: number, employerRate: number): InsurancePremiumBreakdown {
  return { employeeAmount: 0, employerAmount: Math.floor(microYen(base, employerRate) / MICRO) };
}

/** 旧データの roundingRule を解釈する。未設定は法定ルール */
export function normalizeRoundingRule(value: unknown): RoundingRule {
  return value === 'round' || value === 'truncate' || value === 'ceil' || value === 'statutory'
    ? value
    : DEFAULT_ROUNDING_RULE;
}
