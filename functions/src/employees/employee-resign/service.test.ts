import { MockFirestore, makeAuth, makeEmployeeDoc } from '../../__tests__/helpers';

let mockDb: MockFirestore;

jest.mock('../../config', () => ({
  get db() {
    return mockDb;
  },
}));

import { resignEmployee } from './service';

beforeEach(() => {
  mockDb = new MockFirestore();
});

const baseInput = {
  companyId: 'company-001',
  employeeId: 'emp-001',
  expectedVersion: 1,
  resignationDate: '2024-12-31T00:00:00.000Z',
};

describe('resignEmployee', () => {
  it('正常に退職処理ができる', async () => {
    const auth = makeAuth();
    mockDb.setDoc('companies/company-001/employees/emp-001', {
      ...makeEmployeeDoc({ isActive: true }),
    });

    const result = await resignEmployee(baseInput, auth);

    expect(result.success).toBe(true);
    expect(result.id).toBe('emp-001');
  });

  it('既に退職済みの場合エラーになる', async () => {
    const auth = makeAuth();
    mockDb.setDoc('companies/company-001/employees/emp-001', {
      ...makeEmployeeDoc({ isActive: false }),
    });

    await expect(
      resignEmployee(baseInput, auth),
    ).rejects.toThrow('この従業員はすでに退職済みです');
  });

  it('バージョン不一致でエラーになる', async () => {
    const auth = makeAuth();
    mockDb.setDoc('companies/company-001/employees/emp-001', {
      ...makeEmployeeDoc({ version: 3 }),
    });

    await expect(
      resignEmployee(baseInput, auth),
    ).rejects.toThrow('データが更新されています');
  });

  it('operator は担当事業所外の従業員を退職処理できない', async () => {
    const auth = makeAuth({
      roles: ['operator'],
      officeIds: ['office-002'],
    });
    mockDb.setDoc('companies/company-001/employees/emp-001', {
      ...makeEmployeeDoc({ officeId: 'office-001' }),
    });

    await expect(
      resignEmployee(baseInput, auth),
    ).rejects.toThrow('担当事業所外です');
  });

  it('論理削除済みの従業員は退職処理できない', async () => {
    const auth = makeAuth();
    mockDb.setDoc('companies/company-001/employees/emp-001', {
      ...makeEmployeeDoc({ deletedAt: new Date() as any }),
    });

    await expect(
      resignEmployee(baseInput, auth),
    ).rejects.toThrow('従業員が見つかりません');
  });
});
