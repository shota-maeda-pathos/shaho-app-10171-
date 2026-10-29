import { makeAuth, makeEmployeeDoc, makeFilingDoc } from '../../__tests__/helpers';

const mockTxGet = jest.fn();
const mockTxSet = jest.fn();
const mockTxUpdate = jest.fn();

jest.mock('../../config', () => ({
  db: {
    doc: jest.fn((path: string) => ({
      path,
      id: path.split('/').pop(),
    })),
    collection: jest.fn((path: string) => ({
      doc: jest.fn(() => ({ path: `${path}/auto-1`, id: 'auto-1' })),
    })),
    runTransaction: jest.fn(async (fn: any) => {
      const tx = { get: mockTxGet, set: mockTxSet, update: mockTxUpdate };
      return fn(tx);
    }),
  },
}));

import { mockSubmitFiling } from './service';

describe('mockSubmitFiling', () => {
  const empDoc = makeEmployeeDoc();
  const approvedFiling = makeFilingDoc({
    workflowStatus: 'approved',
    formData: {
      lastName: '山田', firstName: '太郎', birthDate: '1990-01-15',
      gender: '男', acquisitionDate: '2020-04-01',
    },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockTxGet.mockImplementation(async (ref: any) => {
      if (ref.path.includes('/employees/') && !ref.path.includes('/filings/')) {
        return { exists: true, data: () => empDoc };
      }
      if (ref.path.includes('/filings/')) {
        return { exists: true, data: () => approvedFiling };
      }
      return { exists: false, data: () => undefined };
    });
  });

  it('必須項目が揃っていれば模擬申請が成功する', async () => {
    const result = await mockSubmitFiling({
      companyId: 'company-001',
      employeeId: 'emp-001',
      filingId: 'filing-001',
      expectedVersion: 1,
    }, makeAuth());

    expect(result.success).toBe(true);
    expect(result.mockStatus).toBe('completed');
    expect(result.validationErrors).toEqual([]);
    expect(mockTxUpdate).toHaveBeenCalled();
  });

  it('必須項目不足で模擬申請が失敗する', async () => {
    const incompleteFiling = makeFilingDoc({
      workflowStatus: 'approved',
      formData: { lastName: '山田' },
    });
    mockTxGet.mockImplementation(async (ref: any) => {
      if (ref.path.includes('/employees/') && !ref.path.includes('/filings/')) {
        return { exists: true, data: () => empDoc };
      }
      if (ref.path.includes('/filings/')) {
        return { exists: true, data: () => incompleteFiling };
      }
      return { exists: false, data: () => undefined };
    });

    const result = await mockSubmitFiling({
      companyId: 'company-001',
      employeeId: 'emp-001',
      filingId: 'filing-001',
      expectedVersion: 1,
    }, makeAuth());

    expect(result.mockStatus).toBe('failed');
    expect(result.validationErrors.length).toBeGreaterThan(0);
  });

  it('承認されていない届出は模擬申請できない', async () => {
    const draftFiling = makeFilingDoc({ workflowStatus: 'draft' });
    mockTxGet.mockImplementation(async (ref: any) => {
      if (ref.path.includes('/employees/') && !ref.path.includes('/filings/')) {
        return { exists: true, data: () => empDoc };
      }
      if (ref.path.includes('/filings/')) {
        return { exists: true, data: () => draftFiling };
      }
      return { exists: false, data: () => undefined };
    });

    await expect(mockSubmitFiling({
      companyId: 'company-001',
      employeeId: 'emp-001',
      filingId: 'filing-001',
      expectedVersion: 1,
    }, makeAuth())).rejects.toThrow('社内承認');
  });

  it('既に完了済みの模擬申請は再実行できない', async () => {
    const completedFiling = makeFilingDoc({
      workflowStatus: 'approved',
      mockStatus: 'completed',
    });
    mockTxGet.mockImplementation(async (ref: any) => {
      if (ref.path.includes('/employees/') && !ref.path.includes('/filings/')) {
        return { exists: true, data: () => empDoc };
      }
      if (ref.path.includes('/filings/')) {
        return { exists: true, data: () => completedFiling };
      }
      return { exists: false, data: () => undefined };
    });

    await expect(mockSubmitFiling({
      companyId: 'company-001',
      employeeId: 'emp-001',
      filingId: 'filing-001',
      expectedVersion: 1,
    }, makeAuth())).rejects.toThrow('既に完了');
  });
});
