import { Timestamp } from 'firebase-admin/firestore';
import { ageFlagsForMonth } from '../insurance/calculator';

/**
 * 社会保険の年齢判定: 「誕生日の前日」に年齢が加算される。
 * yearMonth末日時点の年齢を返す。
 * 例: 1990-04-01 生まれ → 2030-03 に40歳（3/31＝前日で到達）
 */
export function ageAtEndOfMonth(birthDate: Timestamp, yearMonth: string): number {
  const birth = birthDate.toDate();
  const [y, m] = yearMonth.split('-').map(Number);

  // 月末日
  const endOfMonth = new Date(y, m, 0); // m月の0日 = (m-1)月末日... ではなく m が1-indexed なので new Date(y, m, 0) = m月の最終日
  // 誕生日の前日
  const dayBeforeBirthday = new Date(birth.getFullYear(), birth.getMonth(), birth.getDate() - 1);

  let age = endOfMonth.getFullYear() - dayBeforeBirthday.getFullYear();
  const monthDiff = endOfMonth.getMonth() - dayBeforeBirthday.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && endOfMonth.getDate() < dayBeforeBirthday.getDate())) {
    age--;
  }

  return Math.max(0, age);
}

const flags = (birthDate: Timestamp, yearMonth: string) => ageFlagsForMonth(birthDate.toDate().toISOString().slice(0, 10), yearMonth);

/** その月の保険料に介護保険料を含める（40歳到達日の月から65歳到達日の月の前月まで） */
export function isLongTermCareAge(birthDate: Timestamp, yearMonth: string): boolean {
  return flags(birthDate, yearMonth).longTermCare;
}

/** その月は厚生年金保険料がない（70歳到達日の月から） */
export function isPensionExcluded(birthDate: Timestamp, yearMonth: string): boolean {
  return flags(birthDate, yearMonth).pensionExcluded;
}

/** その月は健康保険料がない（75歳の誕生日の月から。後期高齢者医療制度） */
export function isHealthExcluded(birthDate: Timestamp, yearMonth: string): boolean {
  return flags(birthDate, yearMonth).healthExcluded;
}
