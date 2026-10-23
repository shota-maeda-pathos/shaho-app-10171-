import { MockFirestore, makeAuth, makeDependentDoc } from '../../__tests__/helpers';

let mockDb: MockFirestore;

jest.mock('../../config', () => ({
  get db() {
    return mockDb;
  },
}));

import { updateDependent } from './service';

beforeEach(() => {
  mockDb = new MockFirestore();
});

describe('updateDependent', () => {
  it('正常に扶養家族を更新できる', async () => {
    const auth = makeAuth();
    mockDb.setDoc(
      'companies/company-001/employees/emp-001/dependents/dep-001',
      { ...makeDependentDoc() },
    );

    const result = await updateDependent(
      { companyId: 'company-001', employeeId: 'emp-001', dependentId: 'dep-001', lastName: '佐藤' },
      auth,
    );

    expect(result.success).toBe(true);
    expect(result.id).toBe('dep-001');
  });

  it('論理削除済みの扶養家族は更新できない', async () => {
    const auth = makeAuth();
    mockDb.setDoc(
      'companies/company-001/employees/emp-001/dependents/dep-001',
      { ...makeDependentDoc({ deletedAt: new Date() as any }) },
    );

    await expect(
      updateDependent(
        { companyId: 'company-001', employeeId: 'emp-001', dependentId: 'dep-001', lastName: '佐藤' },
        auth,
      ),
    ).rejects.toThrow('扶養家族が見つかりません');
  });

  it('disqualificationDate を null に設定できる', async () => {
    const auth = makeAuth();
    mockDb.setDoc(
      'companies/company-001/employees/emp-001/dependents/dep-001',
      { ...makeDependentDoc() },
    );

    const result = await updateDependent(
      {
        companyId: 'company-001',
        employeeId: 'emp-001',
        dependentId: 'dep-001',
        disqualificationDate: null,
      },
      auth,
    );

    expect(result.success).toBe(true);
  });
});
