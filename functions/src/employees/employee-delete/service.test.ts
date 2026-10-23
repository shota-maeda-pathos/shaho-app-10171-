import { MockFirestore, makeAuth, makeEmployeeDoc } from '../../__tests__/helpers';

let mockDb: MockFirestore;

jest.mock('../../config', () => ({
  get db() {
    return mockDb;
  },
}));

import { deleteEmployee } from './service';

beforeEach(() => {
  mockDb = new MockFirestore();
});

describe('deleteEmployee', () => {
  it('正常に論理削除できる', async () => {
    const auth = makeAuth();
    mockDb.setDoc('companies/company-001/employees/emp-001', {
      ...makeEmployeeDoc(),
    });

    const result = await deleteEmployee(
      { companyId: 'company-001', employeeId: 'emp-001', expectedVersion: 1 },
      auth,
    );

    expect(result.success).toBe(true);
  });

  it('バージョン不一致でエラーになる', async () => {
    const auth = makeAuth();
    mockDb.setDoc('companies/company-001/employees/emp-001', {
      ...makeEmployeeDoc({ version: 2 }),
    });

    await expect(
      deleteEmployee(
        { companyId: 'company-001', employeeId: 'emp-001', expectedVersion: 1 },
        auth,
      ),
    ).rejects.toThrow('データが更新されています');
  });

  it('既に削除済みの従業員はエラーになる', async () => {
    const auth = makeAuth();
    mockDb.setDoc('companies/company-001/employees/emp-001', {
      ...makeEmployeeDoc({ deletedAt: new Date() as any }),
    });

    await expect(
      deleteEmployee(
        { companyId: 'company-001', employeeId: 'emp-001', expectedVersion: 1 },
        auth,
      ),
    ).rejects.toThrow('従業員が見つかりません');
  });
});
