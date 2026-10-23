import { makeAuth, makeEmployeeDoc, makeFilingDoc, MockFirestore } from '../../__tests__/helpers';

let mockDb: MockFirestore;

jest.mock('../../config', () => ({
  get db() {
    return mockDb;
  },
}));

import { submitFiling } from './service';

describe('submitFiling', () => {
  beforeEach(() => {
    mockDb = new MockFirestore();
  });

  it('承認済み届出を提出できる', async () => {
    const empDoc = makeEmployeeDoc();
    const filing = makeFilingDoc({ workflowStatus: 'approved' });
    mockDb.setDoc('companies/company-001/employees/emp-001', empDoc as any);
    mockDb.setDoc(
      'companies/company-001/employees/emp-001/filings/filing-001',
      filing as any,
    );

    const auth = makeAuth();
    const result = await submitFiling(
      {
        companyId: 'company-001',
        employeeId: 'emp-001',
        filingId: 'filing-001',
        expectedVersion: 1,
      },
      auth,
    );

    expect(result.success).toBe(true);
    expect(result.id).toBe('filing-001');
  });

  it('社内承認が完了していない場合はエラー', async () => {
    const empDoc = makeEmployeeDoc();
    const filing = makeFilingDoc({ workflowStatus: 'draft' });
    mockDb.setDoc('companies/company-001/employees/emp-001', empDoc as any);
    mockDb.setDoc(
      'companies/company-001/employees/emp-001/filings/filing-001',
      filing as any,
    );

    const auth = makeAuth();
    await expect(
      submitFiling(
        {
          companyId: 'company-001',
          employeeId: 'emp-001',
          filingId: 'filing-001',
          expectedVersion: 1,
        },
        auth,
      ),
    ).rejects.toThrow('承認が完了していない');
  });

  it('版番号が一致しない場合はエラー', async () => {
    const empDoc = makeEmployeeDoc();
    const filing = makeFilingDoc({ workflowStatus: 'approved', version: 2 });
    mockDb.setDoc('companies/company-001/employees/emp-001', empDoc as any);
    mockDb.setDoc(
      'companies/company-001/employees/emp-001/filings/filing-001',
      filing as any,
    );

    const auth = makeAuth();
    await expect(
      submitFiling(
        {
          companyId: 'company-001',
          employeeId: 'emp-001',
          filingId: 'filing-001',
          expectedVersion: 1,
        },
        auth,
      ),
    ).rejects.toThrow('版番号');
  });

  it('既に提出済みの場合はエラー', async () => {
    const empDoc = makeEmployeeDoc();
    const filing = makeFilingDoc({
      workflowStatus: 'approved',
      submissionStatus: 'submitted',
    });
    mockDb.setDoc('companies/company-001/employees/emp-001', empDoc as any);
    mockDb.setDoc(
      'companies/company-001/employees/emp-001/filings/filing-001',
      filing as any,
    );

    const auth = makeAuth();
    await expect(
      submitFiling(
        {
          companyId: 'company-001',
          employeeId: 'emp-001',
          filingId: 'filing-001',
          expectedVersion: 1,
        },
        auth,
      ),
    ).rejects.toThrow('提出済み');
  });
});
