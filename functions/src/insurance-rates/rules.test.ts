import { parseRateCsv, previousMonth } from './rules';

const split = (l: string) => l.split(',');

describe('料率の CSV', () => {
  it('見出しを飛ばし、種類は日本語でもコードでも読める。本人・会社は空なら折半（拠出金は会社だけ）', () => {
    const { rows, errors } = parseRateCsv('保険の種類,都道府県コード,保険者ID,適用開始年月,料率(‰),本人負担(‰),会社負担(‰),備考\n健康保険,13,,2027-03,99.5,,,東京\nchildSupport,,,2027-04,3.6,,,\n', split);
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ insuranceType: 'health', prefectureCode: '13', appliedFrom: '2027-03', employeeRate: 49.75, employerRate: 49.75 });
    expect(rows[1]).toMatchObject({ insuranceType: 'childSupport', employeeRate: 0, employerRate: 3.6 });
  });
  it('％や小数の取り違え・合計の不一致・重複を止める', () => {
    const { errors } = parseRateCsv('健康保険,13,,2027-03,9.95,,,\n健康保険,13,,2027-03,99.5,40,50,\n厚生年金,,,2027-04,183,,,\n厚生年金,,,2027-04,183,,,\n', split);
    expect(errors[0]).toMatch('範囲外');
    expect(errors[1]).toMatch('合計');
    expect(errors.at(-1)).toMatch('2つあります');
  });
  it('前の月', () => {
    expect(previousMonth('2027-01')).toBe('2026-12');
    expect(previousMonth('2027-03')).toBe('2027-02');
  });
});
