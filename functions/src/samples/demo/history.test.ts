jest.mock('../../config', () => ({ db: {} }));
import { Timestamp } from 'firebase-admin/firestore';
import { buildDemoEmployees, DEMO_OFFICES } from './data';
import { demoBonus, demoGrades, demoPremium, demoSchedule, gradeFor, salaryIn } from './history';

const list = buildDemoEmployees();
const hq = DEMO_OFFICES[0], osaka = DEMO_OFFICES[1];
const rate = (insuranceType: string, e: number, r: number) => ({ insuranceType, appliedFrom: '2024-04', employeeRate: e, employerRate: r, totalRate: e + r }) as any;
const rates = { health: rate('health', 49.55, 49.55), pension: rate('pension', 91.5, 91.5), childSupport: rate('childSupport', 0, 3.6), longTermCare: rate('longTermCare', 7.95, 7.95), childSupportPayment: null };

describe('評価用のテストデータの履歴', () => {
  it('当月控除は先月分まで、翌月控除は先々月分まで保険料が終わり、今月の給与は未処理', () => {
    const e = list.find(x => x.officeId === 'office-hq' && x.hireDate < '2025-01-01')!;
    const s = demoSchedule(e, hq);
    expect(s.premiumMonths[0]).toBe('2025-12');
    expect(s.premiumMonths.at(-1)).toBe('2026-10');
    expect(s.payMonths.at(-1)).toEqual({ payMonth: '2026-11', done: false, deductedPremiumMonth: null });
    const o = demoSchedule({ ...e, officeId: 'office-osaka' }, osaka);
    expect(o.premiumMonths.at(-1)).toBe('2026-09');
    expect(o.payMonths.find(p => p.payMonth === '2026-10')).toEqual({ payMonth: '2026-10', done: true, deductedPremiumMonth: '2026-09' });
    expect(o.payMonths[0]).toEqual({ payMonth: '2025-12', done: true, deductedPremiumMonth: null });
  });
  it('2026年4月入社は資格取得時決定、そのあと9月の定時決定。履歴のどの月にも等級がある', () => {
    const e = list.find(x => x.hireDate === '2026-04-01')!;
    expect(demoGrades(e).map(g => [g.effectiveMonth, g.determinationType])).toEqual([['2026-04', 'initial'], ['2026-09', 'regular']]);
    for (const p of list) {
      const grades = demoGrades(p);
      for (const m of demoSchedule(p, DEMO_OFFICES.find(o => o.id === p.officeId)!).premiumMonths) expect(gradeFor(grades, m)).not.toBeNull();
    }
  });
  it('定時決定は4〜6月の平均、4月に昇給している', () => {
    const e = list.find(x => x.n === 1)!;
    expect(salaryIn(e, '2026-03').base).toBeLessThan(salaryIn(e, '2026-04').base);
    const g = demoGrades(e).find(x => x.effectiveMonth === '2026-09')!;
    expect(g.basisRemuneration).toBe(Math.floor((salaryIn(e, '2026-04').total + salaryIn(e, '2026-05').total + salaryIn(e, '2026-06').total) / 3));
  });
  it('保険料は料率どおり。70歳以上は厚生年金なし、40〜64歳は介護保険あり', () => {
    const grade = { effectiveMonth: '2026-09', determinationType: 'regular' as const, basisRemuneration: 300_000, basisMonths: null, healthGradeNumber: 22, healthStandardRemuneration: 300_000, pensionGradeNumber: 19, pensionStandardRemuneration: 300_000, reason: '' };
    const young = demoPremium(Timestamp.fromDate(new Date('1995-01-01T00:00:00Z')), grade, rates, 'statutory', '2026-10');
    expect(young.healthInsurance).toEqual({ employeeAmount: 14865, employerAmount: 14865 });
    expect(young.pensionInsurance).toEqual({ employeeAmount: 27450, employerAmount: 27450 });
    expect(young.longTermCareInsurance).toBeNull();
    expect(young.childSupportPayment.employeeAmount).toBe(345);
    const middle = demoPremium(Timestamp.fromDate(new Date('1980-01-01T00:00:00Z')), grade, rates, 'statutory', '2026-10');
    expect(middle.longTermCareInsurance).toEqual({ employeeAmount: 2385, employerAmount: 2385 });
    const old = demoPremium(Timestamp.fromDate(new Date('1953-05-01T00:00:00Z')), grade, rates, 'statutory', '2026-10');
    expect(old.isPensionExcluded).toBe(true);
    expect(old.pensionInsurance).toEqual({ employeeAmount: 0, employerAmount: 0 });
  });
  it('賞与は正社員だけ', () => {
    expect(demoBonus(list.find(x => x.insuredCategory === 'partTimer')!, '2026-07')).toBeNull();
    expect(demoBonus(list.find(x => x.n === 1)!, '2026-07')!.standard % 1000).toBe(0);
  });
});
