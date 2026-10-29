import { calculateChildSupportPayment as calculate } from './child-support-payment';

test('FY2026: 標準報酬50万円の支援金は本人575円・会社575円', () => {
  expect(calculate(500000, '2026-10', false, 'truncate')).toEqual({ employeeAmount: 575, employerAmount: 575 });
});
test.each(['2026-03', '2025-10'])('導入前の%sは0円', month => {
  expect(calculate(500000, month, false, 'truncate')).toEqual({ employeeAmount: 0, employerAmount: 0 });
});
test.each(['2026-04', '2027-03'])('適用期間の境界%sを含む', month => {
  expect(calculate(500000, month, false, 'truncate').employeeAmount).toBe(575);
});
test('健康保険の対象外・免除では0円', () => {
  expect(calculate(500000, '2026-10', true, 'truncate')).toEqual({ employeeAmount: 0, employerAmount: 0 });
});
test('未設定の翌年度に2026年度率を持ち越さない', () => {
  expect(() => calculate(500000, '2027-04', false, 'truncate')).toThrow('設定されていません');
});
test('明示された対象年月の料率を優先する（単位‰）', () => {
  expect(calculate(500000, '2027-04', false, 'truncate', { employeeRate: 2, employerRate: 2 })).toEqual({ employeeAmount: 1000, employerAmount: 1000 });
});
test('料率の不正値を黙って計上しない', () => {
  expect(() => calculate(500000, '2026-10', false, 'truncate', { employeeRate: NaN, employerRate: 1.15 })).toThrow('確認してください');
});
