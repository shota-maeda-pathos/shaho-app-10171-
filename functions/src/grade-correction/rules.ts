// 等級の遡及訂正（カタログ5章 修正等級・6章 訂正・遡及）の判定。データベースに触れない

export type PremiumState = 'unconfirmed' | 'pending' | 'confirmed';

export interface ImpactMonth {
  yearMonth: string;
  state: PremiumState;
  beforeEmployee: number;
  beforeEmployer: number;
  afterEmployee: number | null;
  afterEmployer: number | null;
  /** 徴収の記録の額（記録がなければ null） */
  collected: number | null;
  /** 直した等級で計算できなかった理由 */
  error: string | null;
}

/** 直した等級が効く月：適用月から、次の等級の前の月まで */
export function monthsInRange(months: string[], effectiveMonth: string, nextGradeMonth: string | null): string[] {
  return months.filter(m => m >= effectiveMonth && (!nextGradeMonth || m < nextGradeMonth)).sort();
}

/**
 * 本人から追加で集める額（マイナスは返す額）。徴収の記録があればそれと比べ、なければ前の額と比べる。
 * 会社負担の差は会社が納める額で調整するので、本人との精算には入れない
 */
export function settlementOf(m: Pick<ImpactMonth, 'beforeEmployee' | 'afterEmployee' | 'collected'>): number {
  if (m.afterEmployee === null) return 0;
  return m.afterEmployee - (m.collected ?? m.beforeEmployee);
}

export function totals(months: ImpactMonth[]) {
  const sum = (f: (m: ImpactMonth) => number) => months.reduce((a, m) => a + f(m), 0);
  return {
    employeeDiff: sum(m => (m.afterEmployee ?? m.beforeEmployee) - m.beforeEmployee),
    employerDiff: sum(m => (m.afterEmployer ?? m.beforeEmployer) - m.beforeEmployer),
    settlement: sum(settlementOf),
  };
}

export const REASON_LABELS = { pensionOffice: '年金事務所からの修正の指示', error: '誤りの訂正' } as const;
