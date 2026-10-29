/**
 * 被保険者の区分（支払基礎日数の判定基準が変わる）
 * - general:   一般の被保険者
 * - partTimer: パートタイマー（通常の労働者の3/4基準を満たして適用された者）
 * - shortTime: 短時間労働者（特定適用事業所の要件で適用された者）
 */
export type InsuredCategory = 'general' | 'partTimer' | 'shortTime';

export interface MonthlyRemuneration {
  yearMonth: string;
  paymentBasisDays: number;
  /** 判定に使う報酬月額（通貨＋現物、遡及差額は除く） */
  remuneration: number;
}

export type SanteiBasis = 'days17' | 'days15' | 'days11' | 'none';

export interface SanteiAverage {
  basis: SanteiBasis;
  usedMonths: MonthlyRemuneration[];
  /** 報酬月額の平均（円未満切捨て）。対象月がなければ null */
  average: number | null;
}

function average(months: MonthlyRemuneration[]): number | null {
  if (months.length === 0) return null;
  return Math.floor(months.reduce((sum, m) => sum + m.remuneration, 0) / months.length);
}

/**
 * 定時決定（算定基礎届）で平均に使う月を選ぶ。
 * 一般：17日以上の月。パート：17日以上の月がなければ15日以上17日未満の月。短時間：11日以上の月。
 */
export function selectSanteiMonths(months: MonthlyRemuneration[], category: InsuredCategory): SanteiAverage {
  if (category === 'shortTime') {
    const used = months.filter(m => m.paymentBasisDays >= 11);
    return { basis: used.length ? 'days11' : 'none', usedMonths: used, average: average(used) };
  }
  const days17 = months.filter(m => m.paymentBasisDays >= 17);
  if (days17.length) return { basis: 'days17', usedMonths: days17, average: average(days17) };
  if (category === 'partTimer') {
    const days15 = months.filter(m => m.paymentBasisDays >= 15);
    if (days15.length) return { basis: 'days15', usedMonths: days15, average: average(days15) };
  }
  return { basis: 'none', usedMonths: [], average: null };
}

/** 随時改定で3か月すべてに必要な支払基礎日数（パートの15日特例は算定のみ） */
export function occasionalRevisionMinDays(category: InsuredCategory): number {
  return category === 'shortTime' ? 11 : 17;
}

export interface OccasionalAverage {
  allMonthsQualified: boolean;
  shortMonths: string[];
  average: number | null;
}

/** 随時改定：変動月から連続3か月の平均。1か月でも日数が足りなければ対象外 */
export function occasionalRevisionAverage(months: MonthlyRemuneration[], category: InsuredCategory): OccasionalAverage {
  const minDays = occasionalRevisionMinDays(category);
  const shortMonths = months.filter(m => m.paymentBasisDays < minDays).map(m => m.yearMonth);
  const allMonthsQualified = months.length === 3 && shortMonths.length === 0;
  return { allMonthsQualified, shortMonths, average: allMonthsQualified ? average(months) : null };
}
