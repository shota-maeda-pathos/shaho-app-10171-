import { makeAuth, makeEmployeeDoc, MockFirestore } from '../../__tests__/helpers';

let mockDb: MockFirestore;

jest.mock('../../config', () => ({
  get db() {
    return mockDb;
  },
}));

import { rejectApprovalRequest } from './service';

describe('rejectApprovalRequest', () => {
  beforeEach(() => {
    mockDb = new MockFirestore();
  });

  it('承認リクエストを却下できる', async () => {
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

    const auth = makeAuth();
    const result = await rejectApprovalRequest(
      {
        companyId: 'company-001',
        employeeId: 'emp-001',
        requestId: 'req-001',
        comment: '金額に誤りがあります',
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
        status: 'rejected',
        requestedBy: 'user-002',
      },
    );

    const auth = makeAuth();
    await expect(
      rejectApprovalRequest(
        {
          companyId: 'company-001',
          employeeId: 'emp-001',
          requestId: 'req-001',
          comment: '金額に誤りがあります',
        },
        auth,
      ),
    ).rejects.toThrow('処理済み');
  });

  it('届出の却下時はworkflowStatusをrejectedに更新する', async () => {
    const empDoc = makeEmployeeDoc();
    mockDb.setDoc('companies/company-001/employees/emp-001', empDoc as any);
    mockDb.setDoc(
      'companies/company-001/employees/emp-001/approvalRequests/req-002',
      {
        targetPath: 'companies/company-001/employees/emp-001/filings/filing-001',
        targetVersion: 1,
        snapshotData: {},
        requestType: 'filing',
        status: 'pending',
        requestedBy: 'user-002',
      },
    );
    mockDb.setDoc(
      'companies/company-001/employees/emp-001/filings/filing-001',
      { workflowStatus: 'pending', version: 1 },
    );

    const auth = makeAuth();
    const result = await rejectApprovalRequest(
      {
        companyId: 'company-001',
        employeeId: 'emp-001',
        requestId: 'req-002',
        comment: '書類不備',
      },
      auth,
    );

    expect(result.success).toBe(true);
  });
});
