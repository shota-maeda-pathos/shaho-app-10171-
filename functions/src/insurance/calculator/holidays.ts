import { addDays, formatDate, parseDate } from './dates';

// 届出の期限の計算。期限が行政機関の休日にあたるときは翌開庁日まで延びる（行政機関の休日に関する法律 第2条）。
// 行政機関の休日：土曜・日曜、国民の祝日（振替休日・国民の休日を含む）、12月29日〜1月3日。

const nthMonday = (year: number, month: number, n: number): string => {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const day = 1 + ((8 - first) % 7) + (n - 1) * 7;
  return formatDate(new Date(Date.UTC(year, month - 1, day)));
};

const ymd = (year: number, month: number, day: number) => formatDate(new Date(Date.UTC(year, month - 1, day)));

/** 春分日・秋分日（1980〜2099年の近似式。国立天文台の暦要項と一致する範囲） */
function equinox(year: number, base: number): number {
  return Math.floor(base + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

const cache = new Map<number, Set<string>>();

/** その年の国民の祝日（振替休日・国民の休日を含む）。2019年以降の祝日法による */
export function nationalHolidays(year: number): Set<string> {
  const hit = cache.get(year);
  if (hit) return hit;
  const days: string[] = [
    ymd(year, 1, 1), nthMonday(year, 1, 2), ymd(year, 2, 11), ymd(year, 3, equinox(year, 20.8431)),
    ymd(year, 4, 29), ymd(year, 5, 3), ymd(year, 5, 4), ymd(year, 5, 5),
    nthMonday(year, 9, 3), ymd(year, 9, equinox(year, 23.2488)), ymd(year, 11, 3), ymd(year, 11, 23),
  ];
  if (year >= 2020) days.push(ymd(year, 2, 23));
  else if (year <= 2018) days.push(ymd(year, 12, 23));
  // 東京オリンピック・パラリンピックの年は海の日・スポーツの日・山の日が移った
  if (year === 2020) days.push(ymd(2020, 7, 23), ymd(2020, 7, 24), ymd(2020, 8, 10));
  else if (year === 2021) days.push(ymd(2021, 7, 22), ymd(2021, 7, 23), ymd(2021, 8, 8));
  else days.push(nthMonday(year, 7, 3), ymd(year, 8, 11), nthMonday(year, 10, 2));
  if (year === 2019) days.push(ymd(2019, 4, 30), ymd(2019, 5, 1), ymd(2019, 5, 2), ymd(2019, 10, 22));

  const set = new Set(days);
  // 振替休日：日曜の祝日の後の、最初の祝日でない日
  for (const d of [...set].sort()) {
    if (parseDate(d).getUTCDay() !== 0) continue;
    let next = addDays(d, 1);
    while (set.has(next)) next = addDays(next, 1);
    set.add(next);
  }
  // 国民の休日：前日と翌日が祝日の平日
  for (const d of [...set].sort()) {
    const between = addDays(d, 1);
    if (!set.has(between) && set.has(addDays(d, 2)) && parseDate(between).getUTCDay() !== 0) set.add(between);
  }
  cache.set(year, set);
  return set;
}

/** 行政機関の休日か */
export function isAdministrativeHoliday(date: string): boolean {
  const d = parseDate(date);
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return true;
  const md = date.slice(5);
  if (md >= '12-29' || md <= '01-03') return true;
  return nationalHolidays(d.getUTCFullYear()).has(date);
}

/** 期限が行政機関の休日にあたれば、翌開庁日まで延ばす */
export function extendToOpenDay(date: string): string {
  let d = date;
  while (isAdministrativeHoliday(d)) d = addDays(d, 1);
  return d;
}

/** 事実の発生から5日以内の届出の期限（初日は数えない。休日なら翌開庁日） */
export function fiveDayDeadline(eventDate: string): string {
  return extendToOpenDay(addDays(eventDate, 5));
}
