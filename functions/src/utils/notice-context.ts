import { db } from '../config';
/** 従業員にかかわるお知らせの文面と事業所（氏名・事業所を読む） */
export async function employeeNoticeContext(companyId: string, employeeId: string): Promise<{ name: string; officeId: string | null }> {
  // 読めなくてもお知らせは出す（承認などの操作をお知らせのために止めない）
  try {
    const e = (await db.doc(`companies/${companyId}/employees/${employeeId}`).get()).data();
    return { name: e ? `${e.lastName ?? ''} ${e.firstName ?? ''}`.trim() : '', officeId: (e?.officeId as string | undefined) ?? null };
  } catch {
    return { name: '', officeId: null };
  }
}

/** 承認の種類の名前（お知らせの文面用） */
export const REQUEST_TYPE_LABELS: Record<string, string> = {
  filing: '届出', salary: '給与', monthlyInsurance: '月々の保険料', bonus: '賞与額', bonusInsurance: '賞与の保険料', grade: '等級', employment: '雇用条件',
};
