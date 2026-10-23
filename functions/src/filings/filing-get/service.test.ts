import { makeAuth, makeEmployeeDoc, makeFilingDoc, MockFirestore } from '../../__tests__/helpers';

let mockDb: MockFirestore;

jest.mock('../../config', () => ({
  get db() {
    return mockDb;
  },
}));

import { getFiling } from './service';

describe('getFiling', () => {
  beforeEach(() => {
    mockDb = new MockFirestore();
  });

  it('届出を取得できる', async () => {
    const empDoc = makeEmployeeDoc();
    const filing = makeFilingDoc();
    mockDb.setDoc('companies/company-001/employees/emp-001', empDoc as any);
    mockDb.setDoc(
      'companies/company-001/employees/emp-001/filings/filing-001',
      filing as any,
    );

    const auth = makeAuth();
    const result = await getFiling(
      { companyId: 'company-001', employeeId: 'emp-001', filingId: 'filing-001' },
      auth,
    );

    expect(result.id).toBe('filing-001');
    expect(result.employeeId).toBe('emp-001');
    expect(result.filingType).toBe('acquisitionNotification');
  });

  it('存在しない従業員の場合はエラー', async () => {
    const auth = makeAuth();
    await expect(
      getFiling(
        { companyId: 'company-001', employeeId: 'emp-999', filingId: 'filing-001' },
        auth,
      ),
    ).rejects.toThrow('従業員が見つかりません');
  });

  it('存在しない届出の場合はエラー', async () => {
    const empDoc = makeEmployeeDoc();
    mockDb.setDoc('companies/company-001/employees/emp-001', empDoc as any);

    const auth = makeAuth();
    await expect(
      getFiling(
        { companyId: 'company-001', employeeId: 'emp-001', filingId: 'filing-999' },
        auth,
      ),
    ).rejects.toThrow('届出が見つかりません');
  });
});
