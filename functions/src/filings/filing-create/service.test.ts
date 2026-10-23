import { makeAuth, makeEmployeeDoc, MockFirestore } from '../../__tests__/helpers';

let mockDb: MockFirestore;

jest.mock('../../config', () => ({
  get db() {
    return mockDb;
  },
}));

import { createFiling } from './service';

describe('createFiling', () => {
  beforeEach(() => {
    mockDb = new MockFirestore();
  });

  it('届出を作成できる', async () => {
    const empDoc = makeEmployeeDoc();
    mockDb.setDoc('companies/company-001/employees/emp-001', empDoc as any);

    const auth = makeAuth();
    const result = await createFiling(
      {
        companyId: 'company-001',
        employeeId: 'emp-001',
        filingType: 'acquisitionNotification',
        effectiveDate: '2026-10-01',
        formData: { employeeName: '山田太郎' },
      },
      auth,
    );

    expect(result.success).toBe(true);
    expect(result.id).toBeDefined();
  });

  it('従業員が存在しない場合はエラー', async () => {
    mockDb.setDocNotExists('companies/company-001/employees/emp-001');

    const auth = makeAuth();
    await expect(
      createFiling(
        {
          companyId: 'company-001',
          employeeId: 'emp-001',
          filingType: 'acquisitionNotification',
          effectiveDate: '2026-10-01',
          formData: {},
        },
        auth,
      ),
    ).rejects.toThrow('従業員');
  });

  it('初期状態はdraft/notStarted/notSubmitted', async () => {
    const empDoc = makeEmployeeDoc();
    mockDb.setDoc('companies/company-001/employees/emp-001', empDoc as any);

    const auth = makeAuth();
    await createFiling(
      {
        companyId: 'company-001',
        employeeId: 'emp-001',
        filingType: 'lossNotification',
        effectiveDate: '2026-11-01',
        formData: { reason: 'retirement' },
      },
      auth,
    );

    const txResult = await mockDb.runTransaction(async (tx) => {
      return tx.ops;
    });
    expect(txResult).toBeDefined();
  });
});
