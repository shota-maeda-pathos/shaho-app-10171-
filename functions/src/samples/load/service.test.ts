jest.mock('../../config', () => ({ db: {} }));
import { buildLoadEmployees } from './service';

describe('負荷テスト用のサンプル', () => {
  it('人数分の社員番号を重ならずに作り、年齢と報酬を散らす', () => {
    const list = buildLoadEmployees(300);
    expect(new Set(list.map(e => e.employeeNumber)).size).toBe(300);
    const years = list.map(e => Number(e.birthDate.slice(0, 4)));
    expect(years.some(y => 2026 - y >= 70)).toBe(true);
    expect(years.some(y => 2026 - y >= 41 && 2026 - y <= 63)).toBe(true);
    expect(new Set(list.map(e => e.remuneration)).size).toBeGreaterThan(20);
    expect(list.filter(e => e.noGrade)).toHaveLength(2);
    expect(list.every(e => /^\d{4}-\d{2}-\d{2}$/.test(e.birthDate))).toBe(true);
  });
});
