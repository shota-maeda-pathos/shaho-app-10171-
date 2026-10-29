import { makeAuth, makeEmployeeDoc, makeOfficeDoc, makeInsuranceRateDoc } from '../../__tests__/helpers';

const mockTxGet = jest.fn();
const mockTxSet = jest.fn();
const mockTxUpdate = jest.fn();
let exemptions: any[] = [];
let confirmed = false;
let pending = false;

const mockQueryGet = jest.fn();
const buildQuery = (path = ""): any => {
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
}));

jest.mock('../../utils/age', () => ({
  isLongTermCareAge: jest.fn(() => false),
  isPensionExcluded: jest.fn(() => false),
  isHealthExcluded: jest.fn(() => false),
}));

import { calculateMonthlyInsurance } from './service';

describe('calculateMonthlyInsurance', () => {
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

  const gradeDoc = {
    effectiveMonth: '2026-09',
    healthGradeNumber: 22,
    healthStandardRemuneration: 300000,
    pensionGradeNumber: 20,
    pensionStandardRemuneration: 300000,
    determinationType: 'regular',
    version: 1,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    exemptions = [];
    confirmed = false;
    pending = false;

    mockFindAllRates.mockResolvedValue({
      health: healthRate,
      pension: pensionRate,
      childSupport: null,
      longTermCare: null,
    });

    mockTxGet.mockImplementation(async (ref: any) => {
      if (ref.path.includes('/salaries/')) return { exists: true, data: () => ({ isConfirmed: true }) };
      if (ref.path.endsWith('/premiumExemptions')) {
        return { docs: exemptions.map((d, i) => ({ id: `exemption-${i}`, data: () => d })) };
      }
      if (ref.path.includes('/employees/') && !ref.path.includes('/monthlyInsurance/')) {
        return { exists: true, data: () => empDoc, id: 'emp-001' };
      }
      if (ref.path.includes('/offices/')) {
        return { exists: true, data: () => officeDoc, id: 'office-001' };
      }
      if (ref.path.includes('/monthlyInsurance/')) {
        return { exists: confirmed || pending, data: () => ({ isConfirmed: confirmed, approvalPending: pending, version: 2 }), id: '2026-10' };
      }
      return { exists: false, data: () => undefined };
    });

    mockQueryGet.mockResolvedValue({ empty: false, docs: [{ id: '2026-09', data: () => gradeDoc }] });
  });

  it('月次保険料を計算できる', async () => {
    const auth = makeAuth();
    const result = await calculateMonthlyInsurance(
      {
        companyId: 'company-001',
        employeeId: 'emp-001',
        yearMonth: '2026-10',
      },
      auth,
    );

    expect(result.success).toBe(true);
    expect(result.id).toBe('2026-10');
    expect(mockTxSet).toHaveBeenCalled();
  });

  it('免除の場合は保険料が0', async () => {
    exemptions = [{ exemptionType: 'maternity', status: 'active', approvedAt: 'approved', isMonthlyExempted: true }];
    const auth = makeAuth();
    const result = await calculateMonthlyInsurance(
      {
        companyId: 'company-001',
        employeeId: 'emp-001',
        yearMonth: '2026-10',
        isExempted: true,
      },
      auth,
    );

    expect(result.success).toBe(true);

    const setCall = mockTxSet.mock.calls.find((c: any) =>
      c[0].path.includes('monthlyInsurance'),
    );
    expect(setCall).toBeDefined();
    if (setCall) {
      const data = setCall[1];
      expect(data.totalEmployeeAmount).toBe(0);
      expect(data.totalEmployerAmount).toBe(0);
      expect(data.isExempted).toBe(true);
    }
  });

  it('等級が見つからない場合はエラー', async () => {
    mockQueryGet.mockResolvedValueOnce({ empty: true, docs: [] });

    const auth = makeAuth();
    await expect(
      calculateMonthlyInsurance(
        {
          companyId: 'company-001',
          employeeId: 'emp-001',
          yearMonth: '2026-10',
        },
        auth,
      ),
    ).rejects.toThrow('等級');
  });
  const calculate = () => calculateMonthlyInsurance({ companyId: 'company-001', employeeId: 'emp-001', yearMonth: '2026-10' }, makeAuth());
  const exemption = { exemptionType: 'childcare', startMonth: '2026-10', endMonth: '2026-10', status: 'active', approvedAt: 'approved', isMonthlyExempted: true };
  const storedData = () => mockTxSet.mock.calls.find((c: any) => c[0].path.includes('/monthlyInsurance/'))?.[1];
  it('支援金を本人・会社に計上し、拠出金を会社負担だけに含める', async () => {
    mockFindAllRates.mockResolvedValue({ health: healthRate, pension: pensionRate, longTermCare: null,
      childSupport: { employeeRate: 99, employerRate: 3.6 } });
    await calculate();
    const d = storedData();
    expect(d.childSupportPayment).toEqual({ employeeAmount: 345, employerAmount: 345 });
    expect(d.childSupportContribution).toEqual({ employeeAmount: 0, employerAmount: 1080 });
    expect(d.totalEmployeeAmount).toBe(d.healthInsurance.employeeAmount + d.pensionInsurance.employeeAmount + 345);
    expect(d.totalEmployerAmount).toBe(d.healthInsurance.employerAmount + d.pensionInsurance.employerAmount + 345 + 1080);
  });
  it('開始月と終了月を含む免除を自動反映し根拠IDを保存する', async () => {
    exemptions = [exemption];
    await calculate();
    expect(storedData()).toMatchObject({ isExempted: true, totalEmployeeAmount: 0, totalEmployerAmount: 0, exemptionIds: ['exemption-0'] });
  });
  it('支援金は健保、拠出金は厚年の標準報酬を使う', async () => {
    mockQueryGet.mockResolvedValue({ empty: false, docs: [{ id: '2026-09', data: () => ({ ...gradeDoc, healthStandardRemuneration: 500000 }) }] });
    mockFindAllRates.mockResolvedValue({ health: healthRate, pension: pensionRate, longTermCare: null,
      childSupport: { employeeRate: 0, employerRate: 3.6 } });
    await calculate();
    expect(storedData()).toMatchObject({ childSupportPayment: { employeeAmount: 575, employerAmount: 575 },
      childSupportContribution: { employeeAmount: 0, employerAmount: 1080 } });
  });
  it('厚年の対象外でも健保対象なら支援金を計上する', async () => {
    jest.requireMock('../../utils/age').isPensionExcluded.mockReturnValueOnce(true);
    mockFindAllRates.mockResolvedValue({ health: healthRate, pension: pensionRate, longTermCare: null,
      childSupport: { employeeRate: 0, employerRate: 3.6 } });
    await calculate();
    expect(storedData()).toMatchObject({ childSupportPayment: { employeeAmount: 345, employerAmount: 345 },
      childSupportContribution: { employeeAmount: 0, employerAmount: 0 } });
  });
  it.each([
    { approvedAt: null }, { isMonthlyExempted: false }, { isMonthlyExempted: undefined },
    { status: 'ended' }, { endMonth: '2026-09' }, { deletedAt: 'deleted' }, { exemptionType: 'childcare_reduced' },
  ])('対象外の免除は適用しない: %j', async (override) => {
    exemptions = [{ ...exemption, ...override }];
    await calculate();
    expect(storedData().isExempted).toBe(false);
    expect(storedData().totalEmployeeAmount).toBeGreaterThan(0);
  });
  it('終了月未定の承認済み免除を反映する', async () => {
    exemptions = [{ ...exemption, endMonth: null }];
    await calculate();
    expect(storedData().isExempted).toBe(true);
  });
  it('免除登録なしで手動免除を強制できない', async () => {
    await expect(calculateMonthlyInsurance({ companyId: 'company-001', employeeId: 'emp-001', yearMonth: '2026-10', isExempted: true }, makeAuth())).rejects.toThrow('一致しません');
    expect(mockTxSet).not.toHaveBeenCalled();
  });
  it('承認済みの保険料計算を上書きしない', async () => {
    confirmed = true;
    await expect(calculate()).rejects.toThrow('承認済み');
    expect(mockTxSet).not.toHaveBeenCalled();
    expect(mockTxUpdate).not.toHaveBeenCalled();
  });

  it('承認待ちの月次計算は上書きしない', async () => {
    pending = true;
    await expect(calculate()).rejects.toThrow('承認申請中');
    expect(mockTxSet).not.toHaveBeenCalled();
    expect(mockTxUpdate).not.toHaveBeenCalled();
  });

});
