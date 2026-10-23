import { MockFirestore, makeAuth, makeEmployeeDoc } from '../../__tests__/helpers';

let mockDb: MockFirestore;

jest.mock('../../config', () => ({
  get db() {
    return mockDb;
  },
}));

import { updateEmployee } from './service';

beforeEach(() => {
  mockDb = new MockFirestore();
});

describe('updateEmployee', () => {
  it('正常に従業員情報を更新できる', async () => {
    const auth = makeAuth();
    mockDb.setDoc('companies/company-001/employees/emp-001', {
      ...makeEmployeeDoc(),
    });

    const result = await updateEmployee(
      {
        companyId: 'company-001',
        employeeId: 'emp-001',
        expectedVersion: 1,
        lastName: '佐藤',
      },
      auth,
    );

    expect(result.success).toBe(true);
    expect(result.id).toBe('emp-001');
  });

  it('バージョン不一致で楽観的ロックエラーになる', async () => {
    const auth = makeAuth();
    mockDb.setDoc('companies/company-001/employees/emp-001', {
      ...makeEmployeeDoc({ version: 3 }),
    });

    await expect(
      updateEmployee(
        {
          companyId: 'company-001',
          employeeId: 'emp-001',
          expectedVersion: 1,
          lastName: '佐藤',
        },
        auth,
      ),
    ).rejects.toThrow('データが更新されています');
  });

  it('論理削除済みの従業員は更新できない', async () => {
    const auth = makeAuth();
    mockDb.setDoc('companies/company-001/employees/emp-001', {
      ...makeEmployeeDoc({ deletedAt: new Date() as any }),
    });

    await expect(
      updateEmployee(
        {
          companyId: 'company-001',
          employeeId: 'emp-001',
          expectedVersion: 1,
          lastName: '佐藤',
        },
        auth,
      ),
    ).rejects.toThrow('従業員が見つかりません');
  });

  it('operator は担当事業所外の従業員を更新できない', async () => {
    const auth = makeAuth({
      roles: ['operator'],
      officeIds: ['office-002'],
    });
    mockDb.setDoc('companies/company-001/employees/emp-001', {
      ...makeEmployeeDoc({ officeId: 'office-001' }),
    });

    await expect(
      updateEmployee(
        {
          companyId: 'company-001',
          employeeId: 'emp-001',
          expectedVersion: 1,
          lastName: '佐藤',
        },
        auth,
      ),
    ).rejects.toThrow('担当事業所外です');
  });
});
