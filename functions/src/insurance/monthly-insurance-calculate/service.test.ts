import { makeAuth, makeEmployeeDoc, makeOfficeDoc, makeInsuranceRateDoc } from '../../__tests__/helpers';

const mockTxGet = jest.fn();
const mockTxSet = jest.fn();
const mockTxUpdate = jest.fn();

const mockQueryGet = jest.fn();
const buildQuery = (): any => {
  const q: any = {
    where: jest.fn(() => buildQuery()),
    orderBy: jest.fn(() => buildQuery()),
    limit: jest.fn(() => buildQuery()),
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
    collection: jest.fn(() => ({
      ...buildQuery(),
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

    mockTxGet.mockImplementation(async (ref: any) => {
      if (ref.path.includes('/employees/') && !ref.path.includes('/monthlyInsurance/')) {
        return { exists: true, data: () => empDoc, id: 'emp-001' };
      }
      if (ref.path.includes('/offices/')) {
        return { exists: true, data: () => officeDoc, id: 'office-001' };
      }
      if (ref.path.includes('/monthlyInsurance/')) {
        return { exists: false, data: () => undefined, id: '2026-10' };
      }
      return { exists: false, data: () => undefined };
    });

    let queryCallCount = 0;
    mockQueryGet.mockImplementation(async () => {
      queryCallCount++;
      if (queryCallCount === 1) {
        return { empty: false, docs: [{ id: '2026-09', data: () => gradeDoc }] };
      }
      if (queryCallCount === 2) {
        return { empty: true, docs: [] };
      }
      if (queryCallCount === 3) {
        return { empty: false, docs: [{ id: 'rate-health', data: () => healthRate }] };
      }
      if (queryCallCount === 4) {
        return { empty: false, docs: [{ id: 'rate-pension', data: () => pensionRate }] };
      }
      return { empty: true, docs: [] };
    });
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
});
