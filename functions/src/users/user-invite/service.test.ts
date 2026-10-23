import { makeAuth } from '../../__tests__/helpers';

const mockTxSet = jest.fn();
const mockQueryGet = jest.fn();

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

import { inviteUser } from './service';

describe('inviteUser', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
        roles: ['operator'],
        officeIds: ['office-001'],
      },
      auth,
    );

    expect(result.success).toBe(true);
    expect(result.id).toBeDefined();
    expect(mockTxSet).toHaveBeenCalled();
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
          roles: ['operator'],
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
          roles: ['viewer'],
        },
        auth,
      ),
    ).rejects.toThrow('既に招待');
  });
});
