import { makeDependentDoc, makeAuth } from '../../__tests__/helpers';

const dep1 = makeDependentDoc({ lastName: '山田', firstName: '花子' });
const dep2 = makeDependentDoc({ lastName: '山田', firstName: '次郎' });

const mockQueryDocs = jest.fn<any, any[]>();
const mockCountGet = jest.fn<any, any[]>();

jest.mock('../../config', () => {
  const buildQuery = () => {
    const q: any = {
      where: jest.fn(() => buildQuery()),
      orderBy: jest.fn(() => buildQuery()),
      startAfter: jest.fn(() => buildQuery()),
      limit: jest.fn(() => buildQuery()),
      count: jest.fn(() => ({
        get: mockCountGet,
      })),
      get: mockQueryDocs,
    };
    return q;
  };

  return {
    db: {
      collection: jest.fn(() => buildQuery()),
      doc: jest.fn((path: string) => ({
        path,
        id: path.split('/').pop(),
        get: jest.fn(async () => ({ exists: false })),
      })),
    },
  };
});

import { listDependents } from './service';

beforeEach(() => {
  mockCountGet.mockResolvedValue({ data: () => ({ count: 2 }) });
  mockQueryDocs.mockResolvedValue({
    docs: [
      { id: 'dep-1', data: () => dep1 },
      { id: 'dep-2', data: () => dep2 },
    ],
  });
});

describe('listDependents', () => {
  it('正常に扶養家族一覧を取得できる', async () => {
    const auth = makeAuth();
    const result = await listDependents(
      { companyId: 'company-001', employeeId: 'emp-001' },
      auth,
    );

    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(result.hasMore).toBe(false);
  });

  it('hasMore が正しく判定される', async () => {
    const dep3 = makeDependentDoc({ lastName: '山田', firstName: '三郎' });
    mockCountGet.mockResolvedValue({ data: () => ({ count: 25 }) });
    mockQueryDocs.mockResolvedValue({
      docs: [
        { id: 'dep-1', data: () => dep1 },
        { id: 'dep-2', data: () => dep2 },
        { id: 'dep-3', data: () => dep3 },
      ],
    });

    const auth = makeAuth();
    const result = await listDependents(
      { companyId: 'company-001', employeeId: 'emp-001', limit: 2 },
      auth,
    );

    expect(result.hasMore).toBe(true);
    expect(result.items).toHaveLength(2);
  });
});
