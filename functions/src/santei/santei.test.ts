import { MockFirestore, makeAuth, makeEmployeeDoc, makeOfficeDoc } from '../__tests__/helpers';
import { HEALTH_GRADE_TABLE, PENSION_GRADE_TABLE } from '../insurance/calculator';
import { computeSanteiRow, SanteiEmployeeData } from './santei-calc';

let mockDb: MockFirestore;
jest.mock('../config', () => ({
  get db() {
    return mockDb;
  },
}));
const mockCreateApproval = jest.fn();
jest.mock('../approvals/approval-request-create/service', () => ({
  createApprovalRequest: (...args: unknown[]) => mockCreateApproval(...args),
}));

import { previewSantei, submitSantei } from './service';

const tables = { health: HEALTH_GRADE_TABLE, pension: PENSION_GRADE_TABLE };
const salary = (total: number, days = 20, isConfirmed = true) => ({ totalSalary: total, paymentBasisDays: days, isConfirmed, totalFixedWage: total } as never);
const data = (overrides: Partial<SanteiEmployeeData> = {}): SanteiEmployeeData => ({
  employeeId: 'emp-001', employeeNumber: '001', employeeName: '山田 太郎',
  acquisitionDate: '2020-04-01', lossDate: null, enrolled: true, insuredCategory: 'general',
  salaries: { '2026-04': salary(300_000), '2026-05': salary(310_000), '2026-06': salary(320_000) },
  currentGrade: { healthGradeNumber: 22, healthStandardRemuneration: 300_000, pensionGradeNumber: 19, pensionStandardRemuneration: 300_000 } as never,
  hasOccasionalRevisionJulToSep: false, approvalStatus: 'none',
  ...overrides,
});

describe('computeSanteiRow', () => {
  it('3か月平均から健保・厚年の等級を別々に決める', () => {
    const r = computeSanteiRow(2026, data(), tables);
    expect(r).toMatchObject({ status: 'ok', average: 310_000, basis: 'days17', changed: true });
    expect(r.proposed).toEqual({ healthGradeNumber: 23, healthStandardRemuneration: 320_000, pensionGradeNumber: 20, pensionStandardRemuneration: 320_000 });
  });

  it('平均額をそのまま標準報酬月額にしない（等級表に当てはめる）', () => {
    const r = computeSanteiRow(2026, data({ salaries: { '2026-04': salary(333_333), '2026-05': salary(333_333), '2026-06': salary(333_334) } }), tables);
    expect(r.average).toBe(333_333);
    expect(r.proposed!.healthStandardRemuneration).toBe(340_000);
  });

  it('17日未満の月を除いて平均する', () => {
    const r = computeSanteiRow(2026, data({ salaries: { '2026-04': salary(300_000, 20), '2026-05': salary(100_000, 10), '2026-06': salary(320_000, 18) } }), tables);
    expect(r.average).toBe(310_000);
    expect(r.months.map(m => m.used)).toEqual([true, false, true]);
  });

  it('パートは17日以上の月がなければ15日以上の月で算定', () => {
    const r = computeSanteiRow(2026, data({ insuredCategory: 'partTimer', salaries: { '2026-04': salary(150_000, 16), '2026-05': salary(140_000, 15), '2026-06': salary(120_000, 14) } }), tables);
    expect(r).toMatchObject({ status: 'ok', basis: 'days15', average: 145_000 });
  });

  it('基準を満たす月がなければ対応要', () => {
    const r = computeSanteiRow(2026, data({ salaries: { '2026-04': salary(100_000, 10), '2026-05': salary(100_000, 10), '2026-06': salary(100_000, 10) } }), tables);
    expect(r.status).toBe('needsAction');
  });

  it.each([
    [{ acquisitionDate: '2026-06-01' }, '6月1日以降'],
    [{ lossDate: '2026-07-01' }, '7月1日まで'],
    [{ hasOccasionalRevisionJulToSep: true }, '随時改定'],
    [{ enrolled: false }, '適用外'],
  ])('除外：%j', (override, reason) => {
    const r = computeSanteiRow(2026, data(override as Partial<SanteiEmployeeData>), tables);
    expect(r.status).toBe('excluded');
    expect(r.reason).toContain(reason);
  });

  it('5月31日の取得は対象。資格取得前の4月は使わない', () => {
    const r = computeSanteiRow(2026, data({ acquisitionDate: '2026-05-01', salaries: { '2026-04': null, '2026-05': salary(300_000), '2026-06': salary(300_000) } }), tables);
    expect(r.status).toBe('ok');
    expect(r.months.map(m => m.yearMonth)).toEqual(['2026-05', '2026-06']);
  });

  it('給与が未登録・未承認なら保留（他の人は止めない）', () => {
    const r = computeSanteiRow(2026, data({ salaries: { '2026-04': salary(300_000), '2026-05': null, '2026-06': salary(300_000, 20, false) } }), tables);
    expect(r.status).toBe('pending');
    expect(r.reason).toContain('5月の給与が未登録');
    expect(r.reason).toContain('6月の給与が未承認');
  });

  it('等級が変わらなくても対象（変更なしとして表示）', () => {
    const r = computeSanteiRow(2026, data({ salaries: { '2026-04': salary(300_000), '2026-05': salary(300_000), '2026-06': salary(300_000) } }), tables);
    expect(r).toMatchObject({ status: 'ok', changed: false });
  });
});

describe('santei service', () => {
  const emp = (id: string) => `companies/company-001/employees/${id}`;
  beforeEach(() => {
    mockDb = new MockFirestore();
    mockCreateApproval.mockReset().mockResolvedValue({ success: true, id: 'req-1' });
    mockDb.setDoc('companies/company-001/offices/office-001', { ...makeOfficeDoc() });
    for (const [id, num, total] of [['emp-001', '001', 300_000], ['emp-002', '002', 400_000], ['emp-003', '003', 500_000]] as const) {
      mockDb.setDoc(emp(id), { ...makeEmployeeDoc({ employeeNumber: num }) });
      mockDb.setDoc(`${emp(id)}/grades/2026-01`, { effectiveMonth: '2026-01', healthGradeNumber: 22, healthStandardRemuneration: 300_000, pensionGradeNumber: 19, pensionStandardRemuneration: 300_000 });
      for (const m of ['04', '05', '06']) mockDb.setDoc(`${emp(id)}/salaries/2026-${m}`, { totalSalary: total, paymentBasisDays: 20, isConfirmed: true, totalFixedWage: total });
    }
  });

  it('社員番号順にページ単位で返す', async () => {
    const first = await previewSantei({ companyId: 'company-001', year: 2026, limit: 2 }, makeAuth());
    expect(first.items.map(i => i.employeeId)).toEqual(['emp-001', 'emp-002']);
    expect(first).toMatchObject({ hasMore: true, effectiveMonth: '2026-09', filingPeriod: { from: '2026-07-01', to: '2026-07-10' } });
    const second = await previewSantei({ companyId: 'company-001', year: 2026, limit: 2, lastDocId: first.lastDocId }, makeAuth());
    expect(second.items.map(i => i.employeeId)).toEqual(['emp-003']);
    expect(second.hasMore).toBe(false);
  });

  it('承認申請はサーバーで再計算した値を使い、等級の文書IDを適用開始月にする', async () => {
    const { results } = await submitSantei({ companyId: 'company-001', year: 2026, employeeIds: ['emp-002'] }, makeAuth());
    expect(results).toEqual([{ employeeId: 'emp-002', ok: true, requestId: 'req-1' }]);
    const [request] = mockCreateApproval.mock.calls[0];
    expect(request).toMatchObject({
      targetPath: `${emp('emp-002')}/grades/2026-09`,
      targetVersion: 0,
      requestType: 'grade',
      metadata: { effectiveMonth: '2026-09', determinationType: 'regular', healthGradeNumber: 27, healthStandardRemuneration: 410_000, pensionGradeNumber: 24, pensionStandardRemuneration: 410_000, basisRemuneration: 400_000 },
    });
  });

  it('対象外・申請済みの人は個別に失敗として返し、他の人は申請する', async () => {
    mockDb.setDoc(`${emp('emp-001')}/approvalRequests/r1`, { targetPath: `${emp('emp-001')}/grades/2026-09`, status: 'pending' });
    mockDb.setDoc(`${emp('emp-003')}/salaries/2026-06`, { totalSalary: 500_000, paymentBasisDays: 20, isConfirmed: false });
    const { results } = await submitSantei({ companyId: 'company-001', year: 2026, employeeIds: ['emp-001', 'emp-002', 'emp-003'] }, makeAuth());
    expect(results.map(r => r.ok)).toEqual([false, true, false]);
    expect(results[0].error).toContain('承認申請中');
    expect(results[2].error).toContain('保留');
    expect(mockCreateApproval).toHaveBeenCalledTimes(1);
  });

  it('担当外の事業所の従業員は申請できない', async () => {
    const { results } = await submitSantei({ companyId: 'company-001', year: 2026, employeeIds: ['emp-001'] }, makeAuth({ roles: ['operator'], officeIds: ['office-999'] }));
    expect(results[0].ok).toBe(false);
    expect(mockCreateApproval).not.toHaveBeenCalled();
  });
});
