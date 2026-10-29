import { Timestamp } from 'firebase-admin/firestore';

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

/** 40歳以上65歳未満: 介護保険第2号被保険者 */
export function isLongTermCareAge(birthDate: Timestamp, yearMonth: string): boolean {
  const age = ageAtEndOfMonth(birthDate, yearMonth);
  return age >= 40 && age < 65;
}

/** 70歳以上: 厚生年金の被保険者資格なし（原則） */
export function isPensionExcluded(birthDate: Timestamp, yearMonth: string): boolean {
  return ageAtEndOfMonth(birthDate, yearMonth) >= 70;
}

/** 75歳以上: 後期高齢者医療制度に移行 */
export function isHealthExcluded(birthDate: Timestamp, yearMonth: string): boolean {
  return ageAtEndOfMonth(birthDate, yearMonth) >= 75;
}
