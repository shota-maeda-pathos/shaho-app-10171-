import { MockFirestore, makeAuth, makeEmployeeDoc } from '../../__tests__/helpers';

let mockDb: MockFirestore;

jest.mock('../../config', () => ({
  get db() {
    return mockDb;
  },
}));

import { transferEmployee } from './service';

beforeEach(() => {
  mockDb = new MockFirestore();
});

const baseInput = {
  companyId: 'company-001',
  employeeId: 'emp-001',
  expectedVersion: 1,
  newOfficeId: 'office-002',
  transferDate: '2024-10-01T00:00:00.000Z',
};

describe('transferEmployee', () => {
  it('正常に異動処理ができる', async () => {
    const auth = makeAuth();
    mockDb.setDoc('companies/company-001/employees/emp-001', {
      ...makeEmployeeDoc({ officeId: 'office-001' }),
    });

    const result = await transferEmployee(baseInput, auth);

    expect(result.success).toBe(true);
    expect(result.id).toBe('emp-001');
  });

  it('同じ事業所への異動はエラーになる', async () => {
    const auth = makeAuth();
    mockDb.setDoc('companies/company-001/employees/emp-001', {
      ...makeEmployeeDoc({ officeId: 'office-002' }),
    });

    await expect(
      transferEmployee(baseInput, auth),
    ).rejects.toThrow('異動先は現在の事業所と異なる必要があります');
  });

  it('バージョン不一致でエラーになる', async () => {
    const auth = makeAuth();
    mockDb.setDoc('companies/company-001/employees/emp-001', {
      ...makeEmployeeDoc({ officeId: 'office-001', version: 5 }),
    });

    await expect(
      transferEmployee(baseInput, auth),
    ).rejects.toThrow('データが更新されています');
  });

  it('operator は異動元と異動先の両方の権限が必要', async () => {
    const auth = makeAuth({
      roles: ['operator'],
      officeIds: ['office-001'],
    });
    mockDb.setDoc('companies/company-001/employees/emp-001', {
      ...makeEmployeeDoc({ officeId: 'office-001' }),
    });

    await expect(
      transferEmployee(baseInput, auth),
    ).rejects.toThrow('担当事業所外です');
  });

  it('論理削除済みの従業員は異動できない', async () => {
    const auth = makeAuth();
    mockDb.setDoc('companies/company-001/employees/emp-001', {
      ...makeEmployeeDoc({ officeId: 'office-001', deletedAt: new Date() as any }),
    });

    await expect(
      transferEmployee(baseInput, auth),
    ).rejects.toThrow('従業員が見つかりません');
  });
});
