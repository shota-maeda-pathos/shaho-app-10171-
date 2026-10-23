import { makeAuth, makeEmployeeDoc, makeFilingDoc, MockFirestore } from '../../__tests__/helpers';

let mockDb: MockFirestore;

jest.mock('../../config', () => ({
  get db() {
    return mockDb;
  },
}));

import { recordFilingResult } from './service';

describe('recordFilingResult', () => {
  beforeEach(() => {
    mockDb = new MockFirestore();
  });

  it('提出済み届出の受理を記録できる', async () => {
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
    const result = await recordFilingResult(
      {
        companyId: 'company-001',
        employeeId: 'emp-001',
        filingId: 'filing-001',
        expectedVersion: 1,
        result: 'accepted',
        note: '正常受理',
      },
      auth,
    );

    expect(result.success).toBe(true);
    expect(result.id).toBe('filing-001');
  });

  it('提出済み届出の返戻を記録できる', async () => {
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
    const result = await recordFilingResult(
      {
        companyId: 'company-001',
        employeeId: 'emp-001',
        filingId: 'filing-001',
        expectedVersion: 1,
        result: 'returned',
        note: '記載不備',
      },
      auth,
    );

    expect(result.success).toBe(true);
  });

  it('未提出の届出にはエラー', async () => {
    const empDoc = makeEmployeeDoc();
    const filing = makeFilingDoc({
      workflowStatus: 'approved',
      submissionStatus: 'notSubmitted',
    });
    mockDb.setDoc('companies/company-001/employees/emp-001', empDoc as any);
    mockDb.setDoc(
      'companies/company-001/employees/emp-001/filings/filing-001',
      filing as any,
    );

    const auth = makeAuth();
    await expect(
      recordFilingResult(
        {
          companyId: 'company-001',
          employeeId: 'emp-001',
          filingId: 'filing-001',
          expectedVersion: 1,
          result: 'accepted',
        },
        auth,
      ),
    ).rejects.toThrow('提出済みの届出のみ');
  });

  it('版番号が一致しない場合はエラー', async () => {
    const empDoc = makeEmployeeDoc();
    const filing = makeFilingDoc({
      workflowStatus: 'approved',
      submissionStatus: 'submitted',
      version: 3,
    });
    mockDb.setDoc('companies/company-001/employees/emp-001', empDoc as any);
    mockDb.setDoc(
      'companies/company-001/employees/emp-001/filings/filing-001',
      filing as any,
    );

    const auth = makeAuth();
    await expect(
      recordFilingResult(
        {
          companyId: 'company-001',
          employeeId: 'emp-001',
          filingId: 'filing-001',
          expectedVersion: 1,
          result: 'accepted',
        },
        auth,
      ),
    ).rejects.toThrow('データが更新されています');
  });
});
