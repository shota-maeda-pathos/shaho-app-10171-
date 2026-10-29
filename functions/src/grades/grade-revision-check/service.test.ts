import { MockFirestore, makeAuth, makeEmployeeDoc, makeOfficeDoc } from '../../__tests__/helpers';

let mockDb: MockFirestore;
jest.mock('../../config', () => ({
  get db() {
    return mockDb;
  },
}));
const mockCreateProcedure = jest.fn();
jest.mock('../../procedures/hooks', () => ({ createSimpleProcedure: (...args: unknown[]) => mockCreateProcedure(...args) }));

import { checkGradeRevision } from './service';

const emp = 'companies/company-001/employees/emp-001';

function setup(params: {
  category?: 'general' | 'partTimer' | 'shortTime';
  employmentType?: string;
  current: { health: [number, number]; pension: [number, number] };
  prevFixed?: number | null;
  months: { days: number; fixed: number; total: number }[];
}) {
  mockDb.setDoc(emp, { ...makeEmployeeDoc() });
  mockDb.setDoc('companies/company-001/offices/office-001', { ...makeOfficeDoc() });
  mockDb.setDoc(`${emp}/employments/e1`, {
    effectiveDate: '2026-01-01', employmentType: params.employmentType ?? 'regular', socialInsuranceEnrolled: true,
    ...(params.category ? { insuredCategory: params.category } : {}),
  });
  mockDb.setDoc(`${emp}/grades/2026-01`, {
    effectiveMonth: '2026-01',
    healthGradeNumber: params.current.health[0], healthStandardRemuneration: params.current.health[1],
    pensionGradeNumber: params.current.pension[0], pensionStandardRemuneration: params.current.pension[1],
  });
  if (params.prevFixed !== null) {
    mockDb.setDoc(`${emp}/salaries/2026-03`, { isConfirmed: true, totalFixedWage: params.prevFixed ?? 300_000, totalSalary: params.prevFixed ?? 300_000, paymentBasisDays: 20 });
  }
  params.months.forEach((m, i) => {
    mockDb.setDoc(`${emp}/salaries/2026-0${4 + i}`, { isConfirmed: true, paymentBasisDays: m.days, totalFixedWage: m.fixed, totalSalary: m.total });
  });
}

const check = () => checkGradeRevision({ companyId: 'company-001', employeeId: 'emp-001', changeMonth: '2026-04' }, makeAuth());
const raise = (total: number, days = 20) => ({ days, fixed: total, total });

beforeEach(() => {
  mockDb = new MockFirestore();
  mockCreateProcedure.mockReset();
});

describe('checkGradeRevision', () => {
  it('健保・厚年とも2等級上がれば改定対象。4か月目から適用', async () => {
    setup({ current: { health: [22, 300_000], pension: [19, 300_000] }, months: [raise(345_000), raise(345_000), raise(345_000)] });
    const r = await check();
    expect(r).toMatchObject({ eligible: true, healthEligible: true, pensionEligible: true, newHealthGrade: 24, newPensionGrade: 21, effectiveMonth: '2026-07' });
    expect(mockCreateProcedure).toHaveBeenCalledTimes(1);
  });

  it('パート（3/4基準）は17日。16日の月があれば対象外', async () => {
    setup({ category: 'partTimer', employmentType: 'partTime', current: { health: [22, 300_000], pension: [19, 300_000] }, months: [raise(345_000, 20), raise(345_000, 16), raise(345_000, 20)] });
    const r = await check();
    expect(r.eligible).toBe(false);
    expect(r.failReasons.join()).toContain('基準（17日）未満');
  });

  it('短時間労働者は11日以上なら判定する', async () => {
    setup({ category: 'shortTime', current: { health: [22, 300_000], pension: [19, 300_000] }, months: [raise(345_000, 11), raise(345_000, 11), raise(345_000, 12)] });
    expect((await check()).eligible).toBe(true);
  });

  it('昇給なのに等級が下がる場合は改定しない', async () => {
    setup({ prevFixed: 250_000, current: { health: [22, 300_000], pension: [19, 300_000] }, months: [{ days: 20, fixed: 260_000, total: 250_000 }, raise(250_000), raise(250_000)] });
    const r = await check();
    expect(r.eligible).toBe(false);
    expect(r.failReasons.join()).toContain('変動方向');
  });

  it('保険ごとに判定：厚年が上限で動かなくても健保が2等級上がれば健保だけ改定', async () => {
    setup({ prevFixed: 650_000, current: { health: [35, 650_000], pension: [32, 650_000] }, months: [raise(700_000), raise(700_000), raise(700_000)] });
    const r = await check();
    expect(r).toMatchObject({ eligible: true, healthEligible: true, pensionEligible: false, newHealthGrade: 37, newPensionGrade: 32, newPensionStandardRemuneration: 650_000 });
  });

  it('上限の特例：厚年31等級から報酬月額665,000円以上で32等級に改定', async () => {
    setup({ prevFixed: 600_000, current: { health: [34, 620_000], pension: [31, 620_000] }, months: [raise(670_000), raise(670_000), raise(670_000)] });
    const r = await check();
    expect(r).toMatchObject({ pensionEligible: true, newPensionGrade: 32 });
  });

  it('前月の給与がなく固定的賃金の変動を確かめられない場合は担当者確認', async () => {
    setup({ prevFixed: null, current: { health: [22, 300_000], pension: [19, 300_000] }, months: [raise(345_000), raise(345_000), raise(345_000)] });
    const r = await check();
    expect(r).toMatchObject({ eligible: false, needsReview: true });
  });

  it('遡及差額は平均から除き、現物給与は含める', async () => {
    setup({ current: { health: [22, 300_000], pension: [19, 300_000] }, months: [raise(345_000), raise(345_000), raise(345_000)] });
    mockDb.setDoc(`${emp}/salaries/2026-06`, { isConfirmed: true, paymentBasisDays: 20, totalFixedWage: 345_000, totalSalary: 400_000, inKindAmount: 5_000, retroactivePay: { amount: 60_000, fromMonth: '2026-04', toMonth: '2026-05' } });
    const r = await check();
    expect(r.months[2].remuneration).toBe(345_000);
    expect(r.averageSalary).toBe(345_000);
  });

  it('終了時改定は1等級差でも対象', async () => {
    setup({ current: { health: [22, 300_000], pension: [19, 300_000] }, months: [raise(285_000), raise(285_000), raise(285_000)] });
    const r = await checkGradeRevision({ companyId: 'company-001', employeeId: 'emp-001', changeMonth: '2026-04', revisionType: 'leaveEnd' }, makeAuth());
    expect(r).toMatchObject({ eligible: true, newHealthGrade: 21 });
    expect(mockCreateProcedure).not.toHaveBeenCalled();
  });
});
