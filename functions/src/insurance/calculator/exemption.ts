import { addDays, addMonths, correspondingDayNextMonth, daysInclusive, lastDayOfMonth, monthOf } from './dates';

export type LeaveKind = 'maternity' | 'childcare';

/** 休業期間。end は休業の最終日（予定または実績） */
export interface LeavePeriod {
  kind: LeaveKind;
  start: string;
  end: string;
}

function contains(period: LeavePeriod, date: string): boolean {
  return period.start <= date && date <= period.end;
}

/**
 * 月額保険料の免除対象月か。
 * 共通：その月の末日が休業期間中なら免除（開始月から「終了日の翌日が属する月の前月」まで）。
 * 育休のみ：同じ月の中で開始し、終了日の翌日も同じ月にある休業で、その月の休業日数が14日以上なら免除。
 */
export function isMonthlyPremiumExempt(period: LeavePeriod, yearMonth: string): boolean {
  if (contains(period, lastDayOfMonth(yearMonth))) return true;
  if (period.kind !== 'childcare') return false;
  const nextDay = addDays(period.end, 1);
  if (monthOf(period.start) !== yearMonth || monthOf(nextDay) !== yearMonth) return false;
  return daysInclusive(period.start, period.end) >= 14;
}

/**
 * 賞与保険料の免除対象か（賞与を支払った月で判定）。
 * 産休：その月の末日が休業期間中なら免除。
 * 育休：その月の末日を含む休業で、休業期間が1か月を超える場合だけ免除。
 */
export function isBonusPremiumExempt(period: LeavePeriod, bonusYearMonth: string): boolean {
  if (!contains(period, lastDayOfMonth(bonusYearMonth))) return false;
  if (period.kind === 'maternity') return true;
  return period.end >= correspondingDayNextMonth(period.start);
}

/** 免除される月の一覧（届出・画面表示用） */
export function exemptMonths(period: LeavePeriod): string[] {
  const months: string[] = [];
  let ym = monthOf(period.start);
  const last = monthOf(addDays(period.end, 1));
  while (ym <= last) {
    if (isMonthlyPremiumExempt(period, ym)) months.push(ym);
    ym = addMonths(ym, 1);
  }
  return months;
}

/**
 * 産前産後休業の期間。
 * 産前：出産日以前42日（多胎は98日）。出産が予定日より遅れた場合は予定日を基準に開始し、出産日までを産前とする。
 * 産後：出産日の翌日から56日。
 */
export function maternityLeavePeriod(params: { expectedBirthDate: string; actualBirthDate?: string | null; multiple?: boolean }): { start: string; end: string } {
  const before = params.multiple ? 98 : 42;
  const birth = params.actualBirthDate ?? params.expectedBirthDate;
  const startBase = birth < params.expectedBirthDate ? birth : params.expectedBirthDate;
  return { start: addDays(startBase, -(before - 1)), end: addDays(birth, 56) };
}
