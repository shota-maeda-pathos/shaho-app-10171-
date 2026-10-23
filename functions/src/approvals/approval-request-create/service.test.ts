import { makeAuth, makeEmployeeDoc, MockFirestore } from '../../__tests__/helpers';

let mockDb: MockFirestore;

jest.mock('../../config', () => ({
  get db() {
    return mockDb;
  },
}));

import { createApprovalRequest } from './service';

describe('createApprovalRequest', () => {
  beforeEach(() => {
    mockDb = new MockFirestore();
  });

  it('承認リクエストを作成できる', async () => {
    const empDoc = makeEmployeeDoc();
    mockDb.setDoc('companies/company-001/employees/emp-001', empDoc as any);
    mockDb.setDoc(
      'companies/company-001/employees/emp-001/salaries/2026-10',
      { totalSalary: 335000, version: 1 },
    );

    const auth = makeAuth();
    const result = await createApprovalRequest(
      {
        companyId: 'company-001',
        employeeId: 'emp-001',
        targetPath: 'companies/company-001/employees/emp-001/salaries/2026-10',
        targetVersion: 1,
        requestType: 'salary',
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
      createApprovalRequest(
        {
          companyId: 'company-001',
          employeeId: 'emp-001',
          targetPath: 'companies/company-001/employees/emp-001/salaries/2026-10',
          targetVersion: 1,
          requestType: 'salary',
        },
        auth,
      ),
    ).rejects.toThrow('従業員');
  });

  it('版番号が一致しない場合はエラー', async () => {
    const empDoc = makeEmployeeDoc();
    mockDb.setDoc('companies/company-001/employees/emp-001', empDoc as any);
    mockDb.setDoc(
      'companies/company-001/employees/emp-001/salaries/2026-10',
      { totalSalary: 335000, version: 2 },
    );

    const auth = makeAuth();
    await expect(
      createApprovalRequest(
        {
          companyId: 'company-001',
          employeeId: 'emp-001',
          targetPath: 'companies/company-001/employees/emp-001/salaries/2026-10',
          targetVersion: 1,
          requestType: 'salary',
        },
        auth,
      ),
    ).rejects.toThrow('版番号');
  });
});
