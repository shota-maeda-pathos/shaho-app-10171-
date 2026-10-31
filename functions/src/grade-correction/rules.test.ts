import { monthsInRange, settlementOf, totals } from './rules';

describe('等級の遡及訂正', () => {
  it('直した等級が効くのは適用月から次の等級の前の月まで', () => {
    const months = ['2026-03', '2026-04', '2026-05', '2026-09', '2026-10'];
    expect(monthsInRange(months, '2026-04', '2026-09')).toEqual(['2026-04', '2026-05']);
    expect(monthsInRange(months, '2026-04', null)).toEqual(['2026-04', '2026-05', '2026-09', '2026-10']);
  });
  it('精算は徴収の記録と比べ、記録がなければ前の額と比べる', () => {
    expect(settlementOf({ beforeEmployee: 15000, afterEmployee: 16500, collected: 15000 })).toBe(1500);
    expect(settlementOf({ beforeEmployee: 15000, afterEmployee: 14000, collected: null })).toBe(-1000);
    expect(settlementOf({ beforeEmployee: 15000, afterEmployee: 16500, collected: 16500 })).toBe(0);
    expect(settlementOf({ beforeEmployee: 15000, afterEmployee: null, collected: null })).toBe(0);
  });
  it('合計は本人・会社の差と精算額', () => {
    const m = (b: number, a: number, collected: number | null = null) => ({ yearMonth: '', state: 'confirmed' as const, beforeEmployee: b, beforeEmployer: b, afterEmployee: a, afterEmployer: a, collected, error: null });
    expect(totals([m(15000, 16500, 15000), m(15000, 16500)])).toEqual({ employeeDiff: 3000, employerDiff: 3000, settlement: 3000 });
  });
});
