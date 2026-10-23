import { makeAuth, MockFirestore } from '../../__tests__/helpers';

let mockDb: MockFirestore;

jest.mock('../../config', () => ({
  get db() {
    return mockDb;
  },
}));

import { updateUserRole } from './service';

describe('updateUserRole', () => {
  beforeEach(() => {
    mockDb = new MockFirestore();
  });

  it('ユーザーのロールを更新できる', async () => {
    mockDb.setDoc('companies/company-001/users/user-002', {
      email: 'user2@example.com',
      displayName: 'ユーザー2',
      roles: ['operator'],
      officeIds: ['office-001'],
      employeeId: null,
      isSuspended: false,
      isLoginDisabled: false,
      lastLoginAt: null,
    });

    const auth = makeAuth();
    const result = await updateUserRole(
      {
        companyId: 'company-001',
        userId: 'user-002',
        roles: ['admin', 'approver'],
      },
      auth,
    );

    expect(result.success).toBe(true);
    expect(result.id).toBe('user-002');
  });

  it('自分自身のロール変更はエラー', async () => {
    const auth = makeAuth();
    await expect(
      updateUserRole(
        {
          companyId: 'company-001',
          userId: 'user-001',
          roles: ['viewer'],
        },
        auth,
      ),
    ).rejects.toThrow('自分自身');
  });

  it('存在しないユーザーはエラー', async () => {
    mockDb.setDocNotExists('companies/company-001/users/user-999');

    const auth = makeAuth();
    await expect(
      updateUserRole(
        {
          companyId: 'company-001',
          userId: 'user-999',
          roles: ['viewer'],
        },
        auth,
      ),
    ).rejects.toThrow('ユーザー');
  });
});
