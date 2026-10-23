import { MockFirestore, makeAuth, makeDependentDoc } from '../../__tests__/helpers';

let mockDb: MockFirestore;

jest.mock('../../config', () => ({
  get db() {
    return mockDb;
  },
}));

import { deleteDependent } from './service';

beforeEach(() => {
  mockDb = new MockFirestore();
});

describe('deleteDependent', () => {
  it('正常に扶養家族を論理削除できる', async () => {
    const auth = makeAuth();
    mockDb.setDoc(
      'companies/company-001/employees/emp-001/dependents/dep-001',
      { ...makeDependentDoc() },
    );

    const result = await deleteDependent(
      { companyId: 'company-001', employeeId: 'emp-001', dependentId: 'dep-001' },
      auth,
    );

    expect(result.success).toBe(true);
    expect(result.id).toBe('dep-001');
  });

  it('論理削除済みの扶養家族はエラーになる', async () => {
    const auth = makeAuth();
    mockDb.setDoc(
      'companies/company-001/employees/emp-001/dependents/dep-001',
      { ...makeDependentDoc({ deletedAt: new Date() as any }) },
    );

    await expect(
      deleteDependent(
        { companyId: 'company-001', employeeId: 'emp-001', dependentId: 'dep-001' },
        auth,
      ),
    ).rejects.toThrow('扶養家族が見つかりません');
  });

  it('存在しない扶養家族はエラーになる', async () => {
    const auth = makeAuth();

    await expect(
      deleteDependent(
        { companyId: 'company-001', employeeId: 'emp-001', dependentId: 'nonexistent' },
        auth,
      ),
    ).rejects.toThrow('扶養家族が見つかりません');
  });
});
