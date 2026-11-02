import { isValidCorporateNumber, isValidInsurerNumber, isValidMyNumber, myNumberCheckDigit } from './check-digit';

describe('検査用数字', () => {
  it('協会けんぽの保険者番号（公表の番号）を正しいと判定し、打ち間違いを見つける', () => {
    for (const n of ['01130012', '01270016', '01280015', '01010016']) expect(isValidInsurerNumber(n)).toBe(true);
    expect(isValidInsurerNumber('27130045')).toBe(false);
    expect(isValidInsurerNumber('01270019')).toBe(false);
    expect(isValidInsurerNumber('0113001')).toBe(false);
  });
  it('個人番号の検査用数字', () => {
    expect(myNumberCheckDigit('12345678001')).toBe(0);
    expect(isValidMyNumber('123456780010')).toBe(true);
    expect(isValidMyNumber('123456780029')).toBe(true);
    expect(isValidMyNumber('123456780011')).toBe(false);
    expect(isValidMyNumber('12345678001')).toBe(false);
  });
  it('法人番号の検査用数字', () => {
    expect(isValidCorporateNumber('9234567890123')).toBe(true);
    expect(isValidCorporateNumber('1234567890123')).toBe(false);
  });
});
