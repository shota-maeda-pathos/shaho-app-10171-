import { makeAuth, makeEmployeeDoc, makeOfficeDoc } from '../../__tests__/helpers';

const mockGet = jest.fn();
const mockSet = jest.fn();
const mockCollectionGet = jest.fn();

jest.mock('../../config', () => ({
  db: {
    doc: jest.fn((path: string) => ({
      path,
      id: path.split('/').pop(),
      get: mockGet,
      set: mockSet,
    })),
    collection: jest.fn((path: string) => {
      const q: any = {
        path,
        where: jest.fn(() => q),
        orderBy: jest.fn(() => q),
        limit: jest.fn(() => q),
        get: mockCollectionGet,
        doc: jest.fn(() => ({
          path: `${path}/auto-1`,
          id: 'auto-1',
          set: mockSet,
        })),
      };
      return q;
    }),
  },
}));

import { autoGenerateFiling } from './service';

describe('autoGenerateFiling', () => {
  const empDoc = makeEmployeeDoc();
  const officeDoc = makeOfficeDoc();

  beforeEach(() => {
    jest.clearAllMocks();
    mockGet.mockImplementation(async (/* ref */) => ({
      exists: true,
      data: () => empDoc,
    }));
    // Override for office
    const { db } = require('../../config');
    db.doc.mockImplementation((path: string) => ({
      path,
      id: path.split('/').pop(),
      get: async () => {
        if (path.includes('/offices/')) return { exists: true, data: () => officeDoc };
        if (path.includes('/employees/')) return { exists: true, data: () => empDoc };
        return { exists: false, data: () => undefined };
      },
      set: mockSet,
    }));

    mockCollectionGet.mockResolvedValue({ empty: true, docs: [] });
    mockSet.mockResolvedValue(undefined);
  });

  it('資格取得届を自動生成できる', async () => {
    const auth = makeAuth();
    const result = await autoGenerateFiling({
      companyId: 'company-001',
      employeeId: 'emp-001',
      filingType: 'acquisitionNotification',
      effectiveDate: '2026-10-27',
    }, auth);

    expect(result.success).toBe(true);
    expect(result.id).toBe('auto-1');
    expect(mockSet).toHaveBeenCalledTimes(2); // filing + audit
    const filingData = mockSet.mock.calls[0][0];
    expect(filingData.filingType).toBe('acquisitionNotification');
    expect(filingData.workflowStatus).toBe('draft');
    expect(filingData.formData.lastName).toBe('山田');
    expect(filingData.formData.acquisitionDate).toBeDefined();
  });

  it('賞与支払届を自動生成できる', async () => {
    const { db } = require('../../config');
    db.doc.mockImplementation((path: string) => ({
      path,
      id: path.split('/').pop(),
      get: async () => {
        if (path.includes('/offices/')) return { exists: true, data: () => officeDoc };
        if (path.includes('/employees/') && !path.includes('/bonuses/') && !path.includes('/bonusInsurance/')) {
          return { exists: true, data: () => empDoc };
        }
        if (path.includes('/bonuses/')) {
          return { exists: true, data: () => ({ totalAmount: 500000, standardBonusAmount: 500000, cumulativeBonusAmount: 500000 }) };
        }
        if (path.includes('/bonusInsurance/')) {
          return { exists: true, data: () => ({ healthInsurance: { employeeAmount: 24950 }, pensionInsurance: { employeeAmount: 45750 } }) };
        }
        return { exists: false, data: () => undefined };
      },
      set: mockSet,
    }));

    const auth = makeAuth();
    const result = await autoGenerateFiling({
      companyId: 'company-001',
      employeeId: 'emp-001',
      filingType: 'bonusPayment',
      effectiveDate: '2026-06-15',
      yearMonth: '2026-06',
    }, auth);

    expect(result.success).toBe(true);
    const filingData = mockSet.mock.calls[0][0];
    expect(filingData.formData.totalAmount).toBe(500000);
    expect(filingData.formData.healthInsuranceAmount).toBe(24950);
  });

  it('従業員が見つからない場合はエラー', async () => {
    const { db } = require('../../config');
    db.doc.mockImplementation((path: string) => ({
      path,
      id: path.split('/').pop(),
      get: async () => ({ exists: false, data: () => undefined }),
      set: mockSet,
    }));

    await expect(autoGenerateFiling({
      companyId: 'company-001',
      employeeId: 'emp-999',
      filingType: 'acquisitionNotification',
      effectiveDate: '2026-10-27',
    }, makeAuth())).rejects.toThrow('従業員');
  });
});
