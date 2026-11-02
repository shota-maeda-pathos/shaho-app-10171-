import { Timestamp } from 'firebase-admin/firestore';
import { makeAuth, makeEmployeeDoc, makeOfficeDoc, makeInsuranceRateDoc } from '../../__tests__/helpers';

const mockTxGet = jest.fn();
const mockTxSet = jest.fn();
const mockTxUpdate = jest.fn();
const mockQueryGet = jest.fn();
let exemptions: any[] = [];
let confirmed = false;
let pending = false;
let sourceBonus: any;
let priorBonuses: Record<string, any> = {};

const buildQuery = (path = ''): any => {
  const q: any = {
    path,
    where: jest.fn(() => buildQuery(path)),
    orderBy: jest.fn(() => buildQuery(path)),
    limit: jest.fn(() => buildQuery(path)),
    get: mockQueryGet,
  };
  return q;
};

jest.mock('../../config', () => ({
  db: {
    doc: jest.fn((path: string) => ({
      path,
      id: path.split('/').pop(),
    })),
    collection: jest.fn((path: string) => ({
      ...buildQuery(path),
      doc: jest.fn((id?: string) => ({
        path: `auto/${id ?? 'auto-1'}`,
        id: id ?? 'auto-1',
      })),
    })),
    runTransaction: jest.fn(async (fn: any) => {
      const tx = {
        get: mockTxGet,
        set: mockTxSet,
        update: mockTxUpdate,
      };
      return fn(tx);
    }),
  },
}));

const mockFindAllRates = jest.fn();
jest.mock('../../utils/insurance-rate', () => ({
  findAllRates: (...args: any[]) => mockFindAllRates(...args),
  rateFingerprint: () => 'fp',
}));

jest.mock('../../utils/age', () => ({
  isLongTermCareAge: jest.fn(() => false),
  isPensionExcluded: jest.fn(() => false),
  isHealthExcluded: jest.fn(() => false),
}));

import { calculateBonusInsurance } from './service';
import { BonusInsuranceCalculateSchema } from './schema';

describe('calculateBonusInsurance', () => {
  const empDoc = makeEmployeeDoc();
  const officeDoc = makeOfficeDoc();
  const healthRate = makeInsuranceRateDoc({
    insuranceType: 'health',
    employeeRate: 49.9,
    employerRate: 49.9,
  });
  const pensionRate = makeInsuranceRateDoc({
    insuranceType: 'pension',
    employeeRate: 91.5,
    employerRate: 91.5,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    exemptions = []; confirmed = false; pending = false; priorBonuses = {};
    sourceBonus = { totalAmount: 500000, standardBonusAmount: 500000, cumulativeBonusAmount: 500000, version: 2, isConfirmed: true };

    mockFindAllRates.mockResolvedValue({
      health: healthRate,
      pension: pensionRate,
      childSupport: null,
      longTermCare: null,
    });

    mockTxGet.mockImplementation(async (ref: any) => {
      if (ref.path.endsWith('/premiumExemptions')) {
        return { docs: exemptions.filter(d => d.startMonth <= '2026-06').map((d, i) => ({ id: `exemption-${i}`, data: () => d })) };
      }
      if (ref.path.endsWith('/bonuses/2026-06')) return { exists: sourceBonus !== null, data: () => sourceBonus, id: '2026-06' };
      if (ref.path.includes('/bonuses/')) { const prior = priorBonuses[ref.id]; return { exists: !!prior, data: () => prior, id: ref.id }; }
      if (ref.path.includes('/employees/') && !ref.path.includes('/bonusInsurance/')) {
        return { exists: true, data: () => empDoc, id: 'emp-001' };
      }
      if (ref.path.includes('/offices/')) {
        return { exists: true, data: () => officeDoc, id: 'office-001' };
      }
      if (ref.path.includes('/bonusInsurance/')) {
        return { exists: confirmed || pending, data: () => ({ isConfirmed: confirmed, approvalPending: pending, version: 2 }), id: '2026-06' };
      }
      return { exists: false, data: () => undefined };
    });

    mockQueryGet.mockResolvedValue({ empty: true, docs: [] });
  });

  it('賞与保険料を計算できる', async () => {
    const auth = makeAuth();
    const result = await calculateBonusInsurance(
      {
        companyId: 'company-001',
        employeeId: 'emp-001',
        yearMonth: '2026-06',
        totalBonusAmount: 500000,
      },
      auth,
    );

    expect(result.success).toBe(true);
    expect(result.id).toBe('2026-06');
    expect(mockTxSet).toHaveBeenCalled();
  });

  it('上限額が適用される', async () => {
    sourceBonus = { ...sourceBonus, totalAmount: 10_000_000, standardBonusAmount: 10_000_000, cumulativeBonusAmount: 10_000_000 };
    const auth = makeAuth();
    const result = await calculateBonusInsurance(
      {
        companyId: 'company-001',
        employeeId: 'emp-001',
        yearMonth: '2026-06',
        totalBonusAmount: 10_000_000,
      },
      auth,
    );

    expect(result.success).toBe(true);

    const setCall = mockTxSet.mock.calls.find((c: any) =>
      c[0].path.includes('bonusInsurance'),
    );
    if (setCall) {
      const data = setCall[1];
      expect(data.healthCappedAmount).toBeLessThanOrEqual(5_730_000);
      expect(data.pensionCappedAmount).toBeLessThanOrEqual(1_500_000);
    }
  });

  it('免除の場合は保険料が0', async () => {
    exemptions = [{ startMonth: '2026-06', endMonth: '2026-06', status: 'active', exemptionType: 'childcare', approvedAt: 'approved', isBonusExempted: true, isMonthlyExempted: false }];
    const auth = makeAuth();
    const result = await calculateBonusInsurance(
      {
        companyId: 'company-001',
        employeeId: 'emp-001',
        yearMonth: '2026-06',
        totalBonusAmount: 500000,
        isExempted: true,
      },
      auth,
    );

    expect(result.success).toBe(true);

    const setCall = mockTxSet.mock.calls.find((c: any) =>
      c[0].path.includes('bonusInsurance'),
    );
    expect(setCall).toBeDefined();
    if (setCall) {
      const data = setCall[1];
      expect(data.totalEmployeeAmount).toBe(0);
      expect(data.totalEmployerAmount).toBe(0);
      expect(data.exemptionIds).toEqual(['exemption-0']);
    }
  });
  const input = { companyId: 'company-001', employeeId: 'emp-001', yearMonth: '2026-06', totalBonusAmount: 500000 };
  const approved = { startMonth: '2026-05', endMonth: null, status: 'active', exemptionType: 'maternity', approvedAt: 'approved', isBonusExempted: true };
  const saved = () => mockTxSet.mock.calls.find((c: any) => c[0].path.includes('/bonusInsurance/'))![1];
  it('defaults to normal calculation without an approved bonus exemption', async () => {
    await calculateBonusInsurance(input, makeAuth());
    expect(saved()).toMatchObject({ isExempted: false, exemptionIds: [], totalEmployeeAmount: 71275, childSupportPayment: { employeeAmount: 575, employerAmount: 575 }, healthInsurance: { employeeAmount: 24950 }, pensionInsurance: { employeeAmount: 45750 } });
  });
  it('derives exemption without a client flag and stores evidence IDs', async () => {
    exemptions = [approved];
    await calculateBonusInsurance(input, makeAuth());
    expect(saved()).toMatchObject({ isExempted: true, exemptionIds: ['exemption-0'], totalEmployeeAmount: 0, totalEmployerAmount: 0 });
  });
  it.each([
    { isBonusExempted: false, isMonthlyExempted: true }, { isBonusExempted: undefined },
    { approvedAt: null }, { status: 'ended' }, { deletedAt: 'deleted' },
    { exemptionType: 'childcare_reduced' }, { endMonth: '2026-05' }, { startMonth: '2026-07' },
  ])('does not exempt non-applicable records %j', async overrides => {
    exemptions = [{ ...approved, ...overrides }];
    await calculateBonusInsurance(input, makeAuth());
    expect(saved()).toMatchObject({ isExempted: false, exemptionIds: [], totalEmployeeAmount: 71275 });
  });
  it.each([false, true])('rejects client exemption override %s when it differs from approved records', async flag => {
    exemptions = flag ? [] : [approved];
    await expect(calculateBonusInsurance({ ...input, isExempted: flag }, makeAuth())).rejects.toThrow('承認済み');
    expect(mockTxSet).not.toHaveBeenCalled(); expect(mockTxUpdate).not.toHaveBeenCalled();
  });
  it.each(['confirmed', 'pending'])('never overwrites %s calculations', async state => {
    confirmed = state === 'confirmed'; pending = state === 'pending';
    await expect(calculateBonusInsurance(input, makeAuth())).rejects.toThrow('再計算');
    expect(mockTxSet).not.toHaveBeenCalled(); expect(mockTxUpdate).not.toHaveBeenCalled();
  });
  it('enforces assigned office before reading exemption records', async () => {
    await expect(calculateBonusInsurance(input, makeAuth({ roles: ['operator'], officeIds: [] }))).rejects.toThrow('担当事業所外');
    expect(mockQueryGet).not.toHaveBeenCalled();
  });
  it('rejects invalid month, nested IDs and unsafe amounts', () => {
    for (const invalid of [{ yearMonth: '2026-13' }, { yearMonth: '2026-00' }, { employeeId: 'a/b' }, { companyId: '' }, { totalBonusAmount: Number.MAX_SAFE_INTEGER + 1 }]) {
      expect(BonusInsuranceCalculateSchema.safeParse({ ...input, ...invalid }).success).toBe(false);
    }
  });
  it.each([null, { isConfirmed: false }])('requires saved, approved bonus data %j', async override => {
    sourceBonus = override === null ? null : { ...sourceBonus, ...override };
    await expect(calculateBonusInsurance(input, makeAuth())).rejects.toThrow('登録・承認');
    expect(mockTxSet).not.toHaveBeenCalled();
  });
  it('rejects an amount different from the approved bonus', async () => {
    await expect(calculateBonusInsurance({ ...input, totalBonusAmount: 1 }, makeAuth())).rejects.toThrow('一致');
    expect(mockTxSet).not.toHaveBeenCalled();
  });
  it('calculates from the stored amount when the client sends no amount', async () => {
    const { totalBonusAmount, ...storedInput } = input;
    await calculateBonusInsurance(storedInput, makeAuth());
    expect(saved()).toMatchObject({ totalBonusAmount, bonusVersion: 2, cumulativeBonusAmount: 500000 });
  });
  it('applies the remaining annual health cap, independently of the monthly pension cap', async () => {
    priorBonuses = { '2026-04': { isConfirmed: true, standardBonusAmount: 5_500_000 } };
    await calculateBonusInsurance(input, makeAuth());
    expect(saved()).toMatchObject({ healthCappedAmount: 230000, pensionCappedAmount: 500000, healthInsurance: { employeeAmount: 11477 }, pensionInsurance: { employeeAmount: 45750 } });
  });
  it('health premium is zero after the annual cap while pension remains payable', async () => {
    priorBonuses = { '2026-04': { isConfirmed: true, standardBonusAmount: 3_000_000 }, '2026-05': { isConfirmed: true, standardBonusAmount: 2_730_000 } };
    await calculateBonusInsurance(input, makeAuth());
    expect(saved()).toMatchObject({ healthCappedAmount: 0, pensionCappedAmount: 500000, totalEmployeeAmount: 45750 });
  });
  it('employer childcare contribution uses the pension cap, independently of remaining health cap', async () => {
    priorBonuses = { '2026-04': { isConfirmed: true, standardBonusAmount: 5_500_000 } };
    mockFindAllRates.mockResolvedValue({
      health: healthRate,
      pension: pensionRate,
      childSupport: { employeeRate: 0, employerRate: 3.6 },
      longTermCare: null,
    });
    await calculateBonusInsurance(input, makeAuth());
    expect(saved().childSupportContribution).toEqual({ employeeAmount: 0, employerAmount: 1800 });
    // 支援金 264.5円：本人は50銭以下切捨てで264円、会社は全額529円−本人264円＝265円
    expect(saved().childSupportPayment).toEqual({ employeeAmount: 264, employerAmount: 265 });
  });
  it('refuses inconsistent saved amounts', async () => {
    sourceBonus.standardBonusAmount = 1;
    await expect(calculateBonusInsurance(input, makeAuth())).rejects.toThrow('標準賞与額');
    expect(mockTxSet).not.toHaveBeenCalled();
  });
  it('counts the fiscal-year cumulative from earlier approved bonuses on the server', async () => {
    priorBonuses = { '2026-04': { isConfirmed: true, standardBonusAmount: 1_000_000 }, '2025-12': { isConfirmed: true, standardBonusAmount: 9_000_000 } };
    await calculateBonusInsurance(input, makeAuth());
    expect(saved()).toMatchObject({ priorCumulativeBonusAmount: 1_000_000, cumulativeBonusAmount: 1_500_000, healthCappedAmount: 500_000 });
  });
  it('refuses while an earlier month in the fiscal year is unapproved', async () => {
    priorBonuses = { '2026-05': { isConfirmed: false, standardBonusAmount: 100_000 } };
    await expect(calculateBonusInsurance(input, makeAuth())).rejects.toThrow('未承認');
  });
  it('charges nothing for a bonus paid in the month of losing coverage before the loss date', async () => {
    const resigned = makeEmployeeDoc({ resignationDate: Timestamp.fromDate(new Date('2026-06-19T00:00:00Z')) });
    mockTxGet.mockImplementationOnce(async () => ({ exists: true, data: () => resigned, id: 'emp-001' }));
    sourceBonus.payments = [{ date: '2026-06-10', cash: 500000, inKind: 0 }];
    await calculateBonusInsurance(input, makeAuth());
    expect(saved()).toMatchObject({ bonusTarget: 'lossMonth', totalEmployeeAmount: 0, totalEmployerAmount: 0, healthCappedAmount: 500000 });
  });
  it('refuses a bonus paid on or after the loss date', async () => {
    const resigned = makeEmployeeDoc({ resignationDate: Timestamp.fromDate(new Date('2026-06-05T00:00:00Z')) });
    mockTxGet.mockImplementationOnce(async () => ({ exists: true, data: () => resigned, id: 'emp-001' }));
    sourceBonus.payments = [{ date: '2026-06-10', cash: 500000, inKind: 0 }];
    await expect(calculateBonusInsurance(input, makeAuth())).rejects.toThrow('対象ではありません');
  });
});
