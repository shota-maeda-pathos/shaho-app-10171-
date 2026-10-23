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

import { calculateBonusInsurance } from './service';

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

    mockTxGet.mockImplementation(async (ref: any) => {
      if (ref.path.includes('/employees/') && !ref.path.includes('/bonusInsurance/')) {
        return { exists: true, data: () => empDoc, id: 'emp-001' };
      }
      if (ref.path.includes('/offices/')) {
        return { exists: true, data: () => officeDoc, id: 'office-001' };
      }
      if (ref.path.includes('/bonusInsurance/')) {
        return { exists: false, data: () => undefined, id: '2026-06' };
      }
      return { exists: false, data: () => undefined };
    });

    let queryCallCount = 0;
    mockQueryGet.mockImplementation(async () => {
      queryCallCount++;
      if (queryCallCount === 1) {
        return { empty: true, docs: [] };
      }
      if (queryCallCount === 2) {
        return { empty: false, docs: [{ id: 'rate-health', data: () => healthRate }] };
      }
      if (queryCallCount === 3) {
        return { empty: false, docs: [{ id: 'rate-pension', data: () => pensionRate }] };
      }
      return { empty: true, docs: [] };
    });
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
    if (setCall) {
      const data = setCall[1];
      expect(data.totalEmployeeAmount).toBe(0);
      expect(data.totalEmployerAmount).toBe(0);
    }
  });
});
