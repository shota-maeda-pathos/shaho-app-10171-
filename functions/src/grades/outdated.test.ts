jest.mock('../config', () => ({ db: {} }));
import { gradeForMonth, isGradeOutdated } from './outdated';

const g = (effectiveMonth: string, health: number, pension = health) => ({
  effectiveMonth, healthGradeNumber: health, healthStandardRemuneration: health * 10000, pensionGradeNumber: pension, pensionStandardRemuneration: pension * 10000,
});
const p = (yearMonth: string, health: number, pension = health) => ({
  yearMonth, healthGradeNumber: health, healthStandardRemuneration: health * 10000, pensionGradeNumber: pension, pensionStandardRemuneration: pension * 10000,
});

test('その月に使う等級は適用月がその月以前で一番新しいもの', () => {
  const grades = [g('2026-04', 20), g('2026-09', 22)];
  expect(gradeForMonth(grades, '2026-08')?.healthGradeNumber).toBe(20);
  expect(gradeForMonth(grades, '2026-09')?.healthGradeNumber).toBe(22);
  expect(gradeForMonth(grades, '2026-03')).toBeNull();
});

test('等級が遡って変わった月だけ古いとみなす', () => {
  const grades = [g('2026-04', 20), g('2026-07', 23)];
  expect(isGradeOutdated(p('2026-06', 20), grades)).toBe(false);
  expect(isGradeOutdated(p('2026-07', 20), grades)).toBe(true);
  expect(isGradeOutdated(p('2026-08', 23), grades)).toBe(false);
});

test('厚生年金だけ違っても古い。等級がなくなったら古い', () => {
  expect(isGradeOutdated(p('2026-06', 20, 19), [g('2026-04', 20, 20)])).toBe(true);
  expect(isGradeOutdated(p('2026-06', 20), [])).toBe(true);
});
