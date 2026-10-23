import { makeAuth, makeEmployeeDoc, MockFirestore } from '../../__tests__/helpers';

let mockDb: MockFirestore;

jest.mock('../../config', () => ({
  get db() {
    return mockDb;
  },
}));

import { getEmployee } from './service';

beforeEach(() => {
  mockDb = new MockFirestore();
});

describe('getEmployee', () => {
  it('admin は従業員詳細を取得できる', async () => {
    const auth = makeAuth({ roles: ['admin'] });
    mockDb.setDoc('companies/company-001/employees/emp-001', {
      ...makeEmployeeDoc(),
    });

    const result = await getEmployee('company-001', 'emp-001', auth);

    expect(result.id).toBe('emp-001');
    expect(result.lastName).toBe('山田');
  });

  it('論理削除済みの従業員は取得できない', async () => {
    const auth = makeAuth();
    mockDb.setDoc('companies/company-001/employees/emp-001', {
      ...makeEmployeeDoc({ deletedAt: new Date() as any }),
    });

    await expect(
      getEmployee('company-001', 'emp-001', auth),
    ).rejects.toThrow('従業員が見つかりません');
  });

  it('存在しない従業員はエラーになる', async () => {
    const auth = makeAuth();

    await expect(
      getEmployee('company-001', 'nonexistent', auth),
    ).rejects.toThrow('従業員が見つかりません');
  });

  it('本人は停止中でも自分の情報を閲覧できる', async () => {
    const auth = makeAuth({
      uid: 'user-self',
      roles: ['employee'],
      isSuspended: true,
    });
    mockDb.setDoc('companies/company-001/employees/emp-001', {
      ...makeEmployeeDoc({ userId: 'user-self' }),
    });

    const result = await getEmployee('company-001', 'emp-001', auth);
    expect(result.id).toBe('emp-001');
  });

  it('停止中ユーザーは他人の情報を閲覧できない', async () => {
    const auth = makeAuth({
      uid: 'user-other',
      roles: ['operator'],
      isSuspended: true,
      officeIds: ['office-001'],
    });
    mockDb.setDoc('companies/company-001/employees/emp-001', {
      ...makeEmployeeDoc({ userId: 'user-self' }),
    });

    await expect(
      getEmployee('company-001', 'emp-001', auth),
    ).rejects.toThrow('アカウントが停止されています');
  });

  it('operator は担当事業所外の従業員を閲覧できない', async () => {
    const auth = makeAuth({
      roles: ['operator'],
      officeIds: ['office-002'],
    });
    mockDb.setDoc('companies/company-001/employees/emp-001', {
      ...makeEmployeeDoc({ officeId: 'office-001' }),
    });

    await expect(
      getEmployee('company-001', 'emp-001', auth),
    ).rejects.toThrow('アクセス権がありません');
  });
});
