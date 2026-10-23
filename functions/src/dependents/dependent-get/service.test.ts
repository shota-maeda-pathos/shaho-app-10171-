import { MockFirestore, makeAuth, makeDependentDoc } from '../../__tests__/helpers';

let mockDb: MockFirestore;

jest.mock('../../config', () => ({
  get db() {
    return mockDb;
  },
}));

import { getDependent } from './service';

beforeEach(() => {
  mockDb = new MockFirestore();
});

describe('getDependent', () => {
  it('正常に扶養家族を取得できる', async () => {
    const auth = makeAuth();
    mockDb.setDoc(
      'companies/company-001/employees/emp-001/dependents/dep-001',
      { ...makeDependentDoc() },
    );

    const result = await getDependent('company-001', 'emp-001', 'dep-001', auth);

    expect(result.id).toBe('dep-001');
    expect(result.lastName).toBe('山田');
  });

  it('論理削除済みの扶養家族は取得できない', async () => {
    const auth = makeAuth();
    mockDb.setDoc(
      'companies/company-001/employees/emp-001/dependents/dep-001',
      { ...makeDependentDoc({ deletedAt: new Date() as any }) },
    );

    await expect(
      getDependent('company-001', 'emp-001', 'dep-001', auth),
    ).rejects.toThrow('扶養家族が見つかりません');
  });

  it('存在しない扶養家族はエラーになる', async () => {
    const auth = makeAuth();

    await expect(
      getDependent('company-001', 'emp-001', 'nonexistent', auth),
    ).rejects.toThrow('扶養家族が見つかりません');
  });
});
