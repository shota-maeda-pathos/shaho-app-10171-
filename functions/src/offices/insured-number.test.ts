import { nextInsuredNumber } from './insured-number';

test('事業所の中の数字の番号の最大と、採番の記録の大きい方の次を付ける', () => {
  expect(nextInsuredNumber([], 0)).toBe('1');
  expect(nextInsuredNumber(['3', '12', null, 'A-7', ' 5 '], 0)).toBe('13');
  expect(nextInsuredNumber(['3'], 20)).toBe('21');
});
