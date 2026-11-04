import { MonthRecord, annualCost, breakdown, changeFactors, fiscalMonths, fiscalYearOf, gradeHistogram } from './rules';

const rec = (employeeId: string, yearMonth: string, total: number, grade = 20, isExempted = false): MonthRecord => ({
  employeeId, yearMonth, healthGrade: grade, pensionGrade: grade,
  health: { employee: 0, employer: 0 }, care: { employee: 0, employer: 0 }, childSupportPayment: { employee: 0, employer: 0 }, childSupportContribution: { employee: 0, employer: 0 }, pension: { employee: 0, employer: 0 },
  totalEmployee: total, totalEmployer: total, isExempted,
});

describe('保険料の分析', () => {
  it('年度は4月から翌3月', () => {
    expect(fiscalMonths(2026)[0]).toBe('2026-04');
    expect(fiscalMonths(2026)[11]).toBe('2027-03');
    expect(fiscalYearOf('2027-02')).toBe(2026);
  });
  it('前月比を入社・退職・等級・免除・その他に分ける', () => {
    const prev = [rec('a', '2026-09', 100), rec('b', '2026-09', 100), rec('c', '2026-09', 100, 20), rec('d', '2026-09', 100)];
    const cur = [rec('a', '2026-10', 100), rec('c', '2026-10', 120, 21), rec('d', '2026-10', 0, 20, true), rec('e', '2026-10', 50)];
    expect(changeFactors(prev, cur)).toEqual({ joined: 100, left: -200, grade: 40, exemption: -200, other: 0 });
  });
  it('内訳は支援金（本人・会社）と拠出金（会社だけ）を分ける', () => {
    const r = { ...rec('a', '2026-09', 0), childSupportPayment: { employee: 276, employer: 276 }, childSupportContribution: { employee: 0, employer: 864 } };
    const b = breakdown([r, r]);
    expect(b.childSupportPayment).toEqual({ employee: 552, employer: 552 });
    expect(b.childSupportContribution).toEqual({ employee: 0, employer: 1728 });
  });
  it('等級の分布', () => {
    expect(gradeHistogram([rec('a', 'x', 0, 22), rec('b', 'x', 0, 20), rec('c', 'x', 0, 22)])).toEqual([{ grade: 20, count: 1 }, { grade: 22, count: 2 }]);
  });
  it('年間の実績と見込み（直近の月が年度末まで続くと仮定）', () => {
    const months = fiscalMonths(2026);
    const r = annualCost(months, new Map([['2026-04', 100], ['2026-05', 120]]), 50);
    expect(r).toMatchObject({ actualMonthly: 220, actual: 270, confirmedMonths: 2, remainingMonths: 10, forecast: 220 + 50 + 120 * 10 });
  });
  it('確定が途中の月は見込みの元にしない', () => {
    const months = fiscalMonths(2026);
    const r = annualCost(months, new Map([['2026-04', 100], ['2026-05', 100], ['2026-06', 5]]), 0, '2026-05');
    expect(r.actual).toBe(205);
    expect(r.forecast).toBe(200 + 100 * 10);
  });
});
