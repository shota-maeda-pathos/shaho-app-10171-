import { makeAuth } from '../../__tests__/helpers';

const user1 = {
  email: 'admin@example.com',
  displayName: '管理者',
  roles: ['admin'],
  officeIds: ['office-001'],
  isSuspended: false,
};
const user2 = {
  email: 'op@example.com',
  displayName: 'オペレータ',
  roles: ['operator'],
  officeIds: ['office-001'],
  isSuspended: false,
};
const invitation1 = {
  email: 'new@example.com',
  roles: ['viewer'],
  status: 'pending',
  expiresAt: { toDate: () => new Date('2026-12-31') },
};

const mockUserQueryDocs = jest.fn<any, any[]>();
const mockInvitationQueryDocs = jest.fn<any, any[]>();

jest.mock('../../config', () => {
  const buildQuery = (getImpl: jest.Mock) => {
    const q: any = {
      where: jest.fn(() => buildQuery(getImpl)),
      orderBy: jest.fn(() => buildQuery(getImpl)),
      get: getImpl,
    };
    return q;
  };

  return {
    db: {
      collection: jest.fn((path: string) => {
        if (path.endsWith('/invitations')) {
          return buildQuery(mockInvitationQueryDocs);
        }
        return buildQuery(mockUserQueryDocs);
      }),
    },
  };
});

import { listUsers } from './service';

beforeEach(() => {
  mockUserQueryDocs.mockResolvedValue({
    docs: [
      { id: 'user-001', data: () => user1 },
      { id: 'user-002', data: () => user2 },
    ],
  });
  mockInvitationQueryDocs.mockResolvedValue({
    docs: [
      { id: 'inv-001', data: () => invitation1 },
    ],
  });
});

describe('listUsers', () => {
  it('ユーザー一覧と招待一覧を取得できる', async () => {
    const auth = makeAuth();
    const result = await listUsers(auth);

    expect(result.users).toHaveLength(2);
    expect(result.users[0].displayName).toBe('管理者');
    expect(result.users[0].roles).toContain('admin');

    expect(result.invitations).toHaveLength(1);
    expect(result.invitations[0].email).toBe('new@example.com');
    expect(result.invitations[0].status).toBe('pending');
  });

  it('ユーザーも招待もない場合は空配列', async () => {
    mockUserQueryDocs.mockResolvedValue({ docs: [] });
    mockInvitationQueryDocs.mockResolvedValue({ docs: [] });

    const auth = makeAuth();
    const result = await listUsers(auth);

    expect(result.users).toHaveLength(0);
    expect(result.invitations).toHaveLength(0);
  });
});
