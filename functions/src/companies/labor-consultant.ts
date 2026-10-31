/** 届出の「社会保険労務士記載欄」に書く文字（カタログ1章 社会保険労務士情報）。委託していなければ空 */
export function laborConsultantText(c: unknown): string {
  const v = c as { name?: unknown; registrationNumber?: unknown } | null | undefined;
  const name = typeof v?.name === 'string' ? v.name.trim() : '';
  if (!name) return '';
  const no = typeof v?.registrationNumber === 'string' ? v.registrationNumber.trim() : '';
  return no ? `${name}（登録番号 ${no}）` : name;
}
