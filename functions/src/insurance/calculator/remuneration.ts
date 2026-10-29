export type WageType = 'monthly' | 'daily' | 'hourly';

/**
 * 資格取得時決定の報酬月額。
 * 月給：月給額。日給：日額 × 月の所定労働日数。時給：時給 × 月の所定労働時間。
 * いずれも固定的な手当と現物給与を加える。
 */
export function acquisitionRemuneration(params: {
  wageType: WageType;
  wageAmount: number;
  monthlyDays?: number | null;
  monthlyHours?: number | null;
  allowances?: number;
  inKind?: number;
}): number {
  const { wageType, wageAmount } = params;
  let base: number;
  if (wageType === 'monthly') {
    base = wageAmount;
  } else if (wageType === 'daily') {
    if (!params.monthlyDays) throw new RangeError('日給者は月の所定労働日数が必要です');
    base = wageAmount * params.monthlyDays;
  } else {
    if (!params.monthlyHours) throw new RangeError('時給者は月の所定労働時間が必要です');
    base = wageAmount * params.monthlyHours;
  }
  return Math.floor(base + (params.allowances ?? 0) + (params.inKind ?? 0));
}

/** 週の所定労働時間から月の所定労働時間を概算する（週 × 52 ÷ 12、小数第1位まで） */
export function monthlyHoursFromWeekly(weeklyHours: number): number {
  return Math.floor((weeklyHours * 52 / 12) * 10) / 10;
}

/**
 * 判定に使う報酬月額 = 総支給（通貨）＋ 現物給与 − 遡及差額
 * 遡及差額は随時改定・定時決定の平均から除く（実際の支給額は書き換えない）
 */
export function remunerationForJudgement(params: { totalSalary: number; inKind?: number | null; retroactiveAmount?: number | null }): number {
  return params.totalSalary + (params.inKind ?? 0) - (params.retroactiveAmount ?? 0);
}
