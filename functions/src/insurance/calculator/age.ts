import { addDays, correspondingDayAfterMonths, monthOf } from './dates';

/** n歳の誕生日（2/29生まれで平年の場合は3/1） */
export function nthBirthday(birthDate: string, n: number): string {
  return correspondingDayAfterMonths(birthDate, 12 * n);
}

/** n歳に到達する日。年齢計算ニ関スル法律により誕生日の前日 */
export function ageReachDate(birthDate: string, n: number): string {
  return addDays(nthBirthday(birthDate, n), -1);
}

export interface AgeEligibility {
  health: boolean;
  pension: boolean;
  /** 介護保険の第2号被保険者（40歳以上65歳未満） */
  longTermCare: boolean;
  /** 年齢で加入しない保険がある場合の説明 */
  notes: string[];
}

/**
 * 年齢による加入の可否（date 時点）。
 * - 厚生年金：70歳到達日（誕生日の前日）から加入しない
 * - 健康保険：75歳の誕生日から後期高齢者医療制度に移るため加入しない
 * - 介護保険：40歳到達日から65歳到達日の前日まで第2号被保険者
 */
export function eligibilityByAge(birthDate: string, date: string): AgeEligibility {
  const health = date < nthBirthday(birthDate, 75);
  const pension = date < ageReachDate(birthDate, 70);
  const longTermCare = health && date >= ageReachDate(birthDate, 40) && date < ageReachDate(birthDate, 65);
  const notes: string[] = [];
  if (!health) notes.push('75歳以上のため健康保険には加入しません（後期高齢者医療制度）');
  if (!pension) notes.push('70歳以上のため厚生年金には加入しません');
  return { health, pension, longTermCare, notes };
}

export interface AgeMonthFlags {
  /** その月の保険料に介護保険料を含める（40歳到達日の月から、65歳到達日の月の前月まで） */
  longTermCare: boolean;
  /** その月は厚生年金保険料がない（70歳到達日＝喪失日の月から） */
  pensionExcluded: boolean;
  /** その月は健康保険料がない（75歳の誕生日＝喪失日の月から） */
  healthExcluded: boolean;
}

/**
 * 保険料の月（yearMonth）ごとの年齢による扱い。資格を失った月の保険料はかからない（喪失月の前月まで）。
 * 70歳は到達日（誕生日の前日）、75歳は誕生日当日に資格を失うため、月の1日生まれの人で結果が分かれる
 * （例：4月1日生まれは、70歳は3月31日に失い厚年は2月分まで、75歳は4月1日に失い健保は3月分まで）
 */
export function ageFlagsForMonth(birthDate: string, yearMonth: string): AgeMonthFlags {
  const healthExcluded = yearMonth >= monthOf(nthBirthday(birthDate, 75));
  return {
    longTermCare: !healthExcluded && yearMonth >= monthOf(ageReachDate(birthDate, 40)) && yearMonth < monthOf(ageReachDate(birthDate, 65)),
    pensionExcluded: yearMonth >= monthOf(ageReachDate(birthDate, 70)),
    healthExcluded,
  };
}
