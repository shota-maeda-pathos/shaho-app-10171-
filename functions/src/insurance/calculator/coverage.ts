import { addDays, monthOf } from './dates';

export interface CoverageMonth {
  /** その月の保険料が発生するか */
  charged: boolean;
  /** 同じ月に資格取得と喪失がある（同月得喪） */
  sameMonthAcquisitionAndLoss: boolean;
  reason: string;
}

/** 資格喪失日 = 退職日の翌日 */
export function lossDateFromResignation(resignationDate: string): string {
  return addDays(resignationDate, 1);
}

/**
 * 資格取得月・喪失月による保険料の発生判定。
 * - 資格取得月：月の途中でも発生する
 * - 資格喪失月：発生しない（月末退職は喪失日が翌月1日なので退職月は発生する）
 * - 同月得喪：1か月分が発生する（厚生年金は後日還付される場合がある）
 */
export function coverageForMonth(acquisitionDate: string, lossDate: string | null, yearMonth: string): CoverageMonth {
  const acquisitionMonth = monthOf(acquisitionDate);
  const lossMonth = lossDate ? monthOf(lossDate) : null;
  if (yearMonth < acquisitionMonth) {
    return { charged: false, sameMonthAcquisitionAndLoss: false, reason: '資格取得前の月です' };
  }
  if (lossMonth !== null && acquisitionMonth === lossMonth) {
    return yearMonth === acquisitionMonth
      ? { charged: true, sameMonthAcquisitionAndLoss: true, reason: '同月得喪のため1か月分が発生します' }
      : { charged: false, sameMonthAcquisitionAndLoss: true, reason: '資格喪失後の月です' };
  }
  if (lossMonth !== null && yearMonth >= lossMonth) {
    return { charged: false, sameMonthAcquisitionAndLoss: false, reason: yearMonth === lossMonth ? '資格喪失月のため発生しません' : '資格喪失後の月です' };
  }
  return { charged: true, sameMonthAcquisitionAndLoss: false, reason: '' };
}
