import { makeAuth, makeEmployeeDoc, MockFirestore } from '../../__tests__/helpers';

let mockDb: MockFirestore;

jest.mock('../../config', () => ({
  get db() {
    return mockDb;
  },
}));

import { approveApprovalRequest } from './service';

describe('approveApprovalRequest', () => {
  beforeEach(() => {
    mockDb = new MockFirestore();
  });

  it('承認リクエストを承認できる', async () => {
    const empDoc = makeEmployeeDoc();
    mockDb.setDoc('companies/company-001/employees/emp-001', empDoc as any);
    mockDb.setDoc(
      'companies/company-001/employees/emp-001/approvalRequests/req-001',
      {
        targetPath: 'companies/company-001/employees/emp-001/salaries/2026-10',
        targetVersion: 1,
        snapshotData: { totalSalary: 335000 },
        requestType: 'salary',
        status: 'pending',
        requestedBy: 'user-002',
        comment: null,
      },
    );
    mockDb.setDoc(
      'companies/company-001/employees/emp-001/salaries/2026-10',
      { totalSalary: 335000, version: 1, isConfirmed: false },
    );

    const auth = makeAuth();
    const result = await approveApprovalRequest(
      {
        companyId: 'company-001',
        employeeId: 'emp-001',
        requestId: 'req-001',
      },
      auth,
    );

    expect(result.success).toBe(true);
    expect(result.id).toBe('req-001');
  });

  it('既に処理済みの場合はエラー', async () => {
    const empDoc = makeEmployeeDoc();
    mockDb.setDoc('companies/company-001/employees/emp-001', empDoc as any);
    mockDb.setDoc(
      'companies/company-001/employees/emp-001/approvalRequests/req-001',
      {
        targetPath: 'companies/company-001/employees/emp-001/salaries/2026-10',
        targetVersion: 1,
        snapshotData: {},
        requestType: 'salary',
        status: 'approved',
        requestedBy: 'user-002',
      },
    );

    const auth = makeAuth();
    await expect(
      approveApprovalRequest(
        {
          companyId: 'company-001',
          employeeId: 'emp-001',
          requestId: 'req-001',
        },
        auth,
      ),
    ).rejects.toThrow('処理済み');
  });

  it('対象の版が変更されている場合はエラー', async () => {
    const empDoc = makeEmployeeDoc();
    mockDb.setDoc('companies/company-001/employees/emp-001', empDoc as any);
    mockDb.setDoc(
      'companies/company-001/employees/emp-001/approvalRequests/req-001',
      {
        targetPath: 'companies/company-001/employees/emp-001/salaries/2026-10',
        targetVersion: 1,
        snapshotData: {},
        requestType: 'salary',
        status: 'pending',
        requestedBy: 'user-002',
      },
    );
    mockDb.setDoc(
      'companies/company-001/employees/emp-001/salaries/2026-10',
      { totalSalary: 400000, version: 2 },
    );

    const auth = makeAuth();
    await expect(
      approveApprovalRequest(
        {
          companyId: 'company-001',
          employeeId: 'emp-001',
          requestId: 'req-001',
        },
        auth,
      ),
    ).rejects.toThrow('変更されています');
  });
});
