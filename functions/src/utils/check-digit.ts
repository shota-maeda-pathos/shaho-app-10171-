// 番号の検査用数字（チェックデジット）。打ち間違いを登録の前に見つける

/** 個人番号（12桁）。11桁の各数字に、右から 2〜7, 2〜6 の重みを掛けた和を 11 で割った余りから求める */
export function myNumberCheckDigit(first11: string): number {
  let sum = 0;
  for (let n = 1; n <= 11; n++) sum += Number(first11[11 - n]) * (n <= 6 ? n + 1 : n - 5);
  const r = sum % 11;
  return r <= 1 ? 0 : 11 - r;
}

export function isValidMyNumber(value: string): boolean {
  return /^\d{12}$/.test(value) && myNumberCheckDigit(value.slice(0, 11)) === Number(value[11]);
}

/** 健康保険の保険者番号（8桁）。7桁の各数字に右から 2・1 を交互に掛け、積の各桁の和の1の位を 10 から引く */
export function insurerCheckDigit(first7: string): number {
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    const v = Number(first7[i]) * ((7 - i) % 2 ? 2 : 1);
    sum += Math.floor(v / 10) + (v % 10);
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidInsurerNumber(value: string): boolean {
  return /^\d{8}$/.test(value) && insurerCheckDigit(value.slice(0, 7)) === Number(value[7]);
}

/** 法人番号（13桁）。先頭が検査用数字で、残り12桁に右から 1・2 を交互に掛けた和を 9 で割った余りを 9 から引く */
export function corporateCheckDigit(last12: string): number {
  let sum = 0;
  for (let n = 1; n <= 12; n++) sum += Number(last12[12 - n]) * (n % 2 ? 1 : 2);
  return 9 - (sum % 9);
}

export function isValidCorporateNumber(value: string): boolean {
  return /^\d{13}$/.test(value) && corporateCheckDigit(value.slice(1)) === Number(value[0]);
}
