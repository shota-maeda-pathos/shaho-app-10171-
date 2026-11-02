import { makeAuth } from '../../__tests__/helpers';

const mockTxSet = jest.fn();
const mockQueryGet = jest.fn();
const mockGetAll = jest.fn();

const buildQuery = (): any => {
  const q: any = {
    where: jest.fn(() => buildQuery()),
    limit: jest.fn(() => buildQuery()),
    get: mockQueryGet,
  };
  return q;
};

jest.mock('../../config', () => ({
  db: {
    getAll: (...refs: any[]) => mockGetAll(...refs),
    doc: jest.fn((path: string) => ({
      path,
      id: path.split('/').pop(),
    })),
    collection: jest.fn(() => ({
      ...buildQuery(),
      doc: jest.fn((id?: string) => ({
        path: `auto/${id ?? 'auto-1'}`,
        id: id ?? 'auto-1',
      })),
    })),
    runTransaction: jest.fn(async (fn: any) => {
      const tx = {
        get: jest.fn(),
        set: mockTxSet,
        update: jest.fn(),
      };
      return fn(tx);
    }),
  },
}));

import { inviteProblem, inviteUser } from './service';

describe('inviteUser', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAll.mockImplementation(async (...refs: any[]) => refs.map(r => ({ id: r.id, exists: true, data: () => ({}) })));
  });

  it('ユーザーを招待できる', async () => {
    let queryCallCount = 0;
    mockQueryGet.mockImplementation(async () => {
      queryCallCount++;
      return { empty: true, docs: [] };
    });

    const auth = makeAuth();
    const result = await inviteUser(
      {
        companyId: 'company-001',
        email: 'new-user@example.com',
        displayName: '新井 一郎',
        roles: ['operator'],
        officeIds: ['office-001'],
      },
      auth,
    );

    expect(result.success).toBe(true);
    expect(result.id).toBeDefined();
    expect(mockTxSet.mock.calls[0][1]).toMatchObject({ displayName: '新井 一郎', roles: ['operator'], officeIds: ['office-001'] });
  });

  it('廃止した事業所・ない事業所は担当にできない', async () => {
    mockQueryGet.mockResolvedValue({ empty: true, docs: [] });
    mockGetAll.mockResolvedValueOnce([{ id: 'office-old', exists: true, data: () => ({ abolishedOn: '2026-10-01' }) }]);
    await expect(inviteUser({ companyId: 'company-001', email: 'a@example.com', displayName: 'A', roles: ['viewer'], officeIds: ['office-old'] }, makeAuth()))
      .rejects.toThrow('廃止');
    expect(mockTxSet).not.toHaveBeenCalled();
  });

  it('既に登録済みメールの場合はエラー', async () => {
    mockQueryGet.mockResolvedValueOnce({
      empty: false,
      docs: [{ id: 'user-existing', data: () => ({ email: 'dup@example.com' }) }],
    });

    const auth = makeAuth();
    await expect(
      inviteUser(
        {
          companyId: 'company-001',
          email: 'dup@example.com',
          displayName: '重複 太郎',
          roles: ['operator'],
          officeIds: ['office-001'],
        },
        auth,
      ),
    ).rejects.toThrow('既に登録');
  });

  it('既に招待済みメールの場合はエラー', async () => {
    mockQueryGet
      .mockResolvedValueOnce({ empty: true, docs: [] })
      .mockResolvedValueOnce({
        empty: false,
        docs: [{ id: 'inv-existing', data: () => ({ email: 'dup@example.com' }) }],
      });

    const auth = makeAuth();
    await expect(
      inviteUser(
        {
          companyId: 'company-001',
          email: 'dup@example.com',
          displayName: '重複 花子',
          roles: ['viewer'],
          officeIds: ['office-001'],
        },
        auth,
      ),
    ).rejects.toThrow('既に招待');
  });
});

describe('inviteProblem', () => {
  it('担当者・承認者・閲覧者は担当事業所が要る。管理者は要らない', () => {
    expect(inviteProblem({ roles: ['operator'], officeIds: [] })).toContain('担当事業所');
    expect(inviteProblem({ roles: ['approver'] })).toContain('担当事業所');
    expect(inviteProblem({ roles: ['admin'] })).toBeNull();
    expect(inviteProblem({ roles: ['admin', 'operator'] })).toBeNull();
    expect(inviteProblem({ roles: ['viewer'], officeIds: ['o1'] })).toBeNull();
  });

  it('従業員（本人）は従業員につなぐ招待でなければ断る', () => {
    expect(inviteProblem({ roles: ['employee'] })).toContain('本人ポータル');
    expect(inviteProblem({ roles: ['approver', 'employee'], officeIds: ['o1'] })).toContain('本人ポータル');
    expect(inviteProblem({ roles: ['employee'], employeeId: 'e1' })).toBeNull();
  });
});
