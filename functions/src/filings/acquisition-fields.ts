import { db } from '../config';
import { EmployeeDoc } from '../types/firestore';

// 資格取得届の、台帳から埋められる欄（住所・被扶養者の有無・備考の項目）。
// 個人番号は届出の文書に書かない（暗号化して別に持つ）ため、住所の欄を埋めて代わりにする（様式の注記「個人番号を記入した場合は住所記入は不要」）。

/** 被保険者の住所（都道府県から建物名まで続けて書く） */
export function insuredAddress(e: Pick<EmployeeDoc, 'prefecture' | 'city' | 'addressLine' | 'building'>): string {
  return [e.prefecture, e.city, e.addressLine, e.building].filter(Boolean).join('');
}

/** 備考の項目（様式の番号：1. 70歳以上被用者該当 2. 二以上事業所勤務者の取得 3. 短時間労働者の取得） */
export function acquisitionRemarkItems(input: { age70: boolean; otherEmployer: boolean; shortTime: boolean }): string[] {
  return [input.age70 ? '1' : '', input.otherEmployer ? '2' : '', input.shortTime ? '3' : ''].filter(Boolean);
}

/** 資格取得届の住所・被扶養者の有無。被扶養者は取り消されていない人がいれば「有」 */
export async function acquisitionLedgerFields(companyId: string, employeeId: string, e: EmployeeDoc): Promise<Record<string, unknown>> {
  const deps = await db.collection(`companies/${companyId}/employees/${employeeId}/dependents`).where('deletedAt', '==', null).get();
  const hasDependent = deps.docs.some(d => d.data().disqualificationDate == null);
  return {
    '被保険者住所': insuredAddress(e),
    '郵便番号': e.postalCode ?? '',
    '被扶養者': hasDependent ? '有' : '無',
  };
}
