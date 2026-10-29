// 日付は 'YYYY-MM-DD'、年月は 'YYYY-MM' の文字列で扱う（タイムゾーンの影響を受けないよう UTC で計算する）

export function parseDate(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(value: string, days: number): string {
  const date = parseDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDate(date);
}

export function monthOf(value: string): string {
  return value.slice(0, 7);
}

export function addMonths(yearMonth: string, n: number): string {
  const [y, m] = yearMonth.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

export function lastDayOfMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number);
  return formatDate(new Date(Date.UTC(y, m, 0)));
}

export function firstDayOfMonth(yearMonth: string): string {
  return `${yearMonth}-01`;
}

/** 期間 [start, end] の日数（両端を含む） */
export function daysInclusive(start: string, end: string): number {
  return Math.round((parseDate(end).getTime() - parseDate(start).getTime()) / 86_400_000) + 1;
}

/**
 * start から「1か月後の応当日」。応当日がない月は翌月の初日（民法143条：1か月の期間は応当日の前日に満了）
 * 例：1/10 → 2/10、1/31 → 3/1
 */
export function correspondingDayNextMonth(start: string): string {
  const [y, m, d] = start.split('-').map(Number);
  const candidate = new Date(Date.UTC(y, m, d));
  if (candidate.getUTCMonth() === m % 12) return formatDate(candidate);
  return formatDate(new Date(Date.UTC(y, m + 1, 1)));
}
