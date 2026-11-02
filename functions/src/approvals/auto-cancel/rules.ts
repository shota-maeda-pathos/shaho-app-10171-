// 承認済み（未送信）の届出の承認を自動で取り消すきっかけ（カタログ1章 会社情報の管理）。
// 届出に載る情報が変わったら、古い内容のまま提出しないよう、承認を取り消して承認し直してもらう。

/** 会社の文書で、届出に載る項目（事業主欄・社会保険労務士欄など） */
export const COMPANY_FILING_FIELDS = ['name', 'representativeName', 'address', 'postalCode', 'phone', 'corporateNumber', 'laborConsultant'] as const;
/** 従業員の文書で、届出に載る項目 */
export const EMPLOYEE_FILING_FIELDS = [
  'lastName', 'firstName', 'lastNameKana', 'firstNameKana', 'birthDate', 'gender',
  'postalCode', 'prefecture', 'city', 'addressLine', 'building', 'basicPensionNumber', 'insuredPersonNumber',
] as const;
/** 給与の文書で、届出（月額変更届・終了時改定の届）の計算に使う項目 */
export const SALARY_FILING_FIELDS = ['totalSalary', 'totalFixedWage', 'totalVariableWage', 'inKindAmount', 'paymentBasisDays', 'retroactivePay'] as const;
/** 給与を使う届出の種類 */
export const SALARY_FILING_TYPES = ['remunerationMonthlyChange', 'maternityLeaveEndChange', 'childcareLeaveEndChange'];

export const FIELD_LABELS: Record<string, string> = {
  name: '会社名', representativeName: '代表者', address: '所在地', postalCode: '郵便番号', phone: '電話番号', corporateNumber: '法人番号',
  laborConsultant: '社会保険労務士', lastName: '姓', firstName: '名', lastNameKana: '姓（カナ）', firstNameKana: '名（カナ）', birthDate: '生年月日',
  gender: '性別', prefecture: '都道府県', city: '市区町村', addressLine: '番地', building: '建物', basicPensionNumber: '基礎年金番号',
  insuredPersonNumber: '被保険者整理番号', totalSalary: '支給額', totalFixedWage: '固定的賃金', totalVariableWage: '非固定的賃金', inKindAmount: '現物給与',
  paymentBasisDays: '支払基礎日数', retroactivePay: '遡及差額',
};

const norm = (v: unknown): string => {
  if (v === undefined || v === null || v === '') return 'null';
  const t = v as { toDate?: () => Date };
  if (typeof t.toDate === 'function') return t.toDate().toISOString();
  return JSON.stringify(v);
};

/** 前後で値が変わった項目（作られた・消されたときは数えない） */
export function changedFields(before: Record<string, unknown> | undefined, after: Record<string, unknown> | undefined, fields: readonly string[]): string[] {
  if (!before || !after) return [];
  return fields.filter(f => norm(before[f]) !== norm(after[f]));
}

/** 通知・取消の理由に書く文 */
export function changeReason(what: string, fields: string[]): string {
  return `${what}の${fields.map(f => FIELD_LABELS[f] ?? f).join('・')}が変わったため、承認を自動で取り消しました。内容を確かめて承認し直してください`;
}
