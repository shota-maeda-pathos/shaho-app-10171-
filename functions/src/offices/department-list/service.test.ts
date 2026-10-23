import { makeAuth, makeDepartmentDoc } from '../../__tests__/helpers';

const dept1 = makeDepartmentDoc({ name: '総務部', sortOrder: 1 });
const dept2 = makeDepartmentDoc({ name: '営業部', sortOrder: 2 });

const mockQueryDocs = jest.fn<any, any[]>();

jest.mock('../../config', () => {
  const buildQuery = () => {
    const q: any = {
      where: jest.fn(() => buildQuery()),
      orderBy: jest.fn(() => buildQuery()),
      get: mockQueryDocs,
    };
    return q;
  };

  return {
    db: {
      collection: jest.fn(() => buildQuery()),
    },
  };
});

import { listDepartments } from './service';

beforeEach(() => {
  mockQueryDocs.mockResolvedValue({
    docs: [
      { id: 'dept-001', data: () => dept1 },
      { id: 'dept-002', data: () => dept2 },
    ],
  });
});

describe('listDepartments', () => {
  it('admin は全部署を取得できる', async () => {
    const auth = makeAuth({ roles: ['admin'] });
    const result = await listDepartments(
      { companyId: 'company-001' },
      auth,
    );

    expect(result.items).toHaveLength(2);
    expect(result.items[0].name).toBe('総務部');
    expect(result.items[1].name).toBe('営業部');
  });

  it('担当事業所が空の operator は空の一覧を返す', async () => {
    const auth = makeAuth({ roles: ['operator'], officeIds: [] });
    const result = await listDepartments(
      { companyId: 'company-001' },
      auth,
    );

    expect(result.items).toHaveLength(0);
  });

  it('レスポンスに階層構造フィールドが含まれる', async () => {
    const nested = makeDepartmentDoc({ name: '営業1課', parentId: 'dept-002' });
    mockQueryDocs.mockResolvedValue({
      docs: [{ id: 'dept-003', data: () => nested }],
    });

    const auth = makeAuth();
    const result = await listDepartments(
      { companyId: 'company-001' },
      auth,
    );

    expect(result.items[0].parentId).toBe('dept-002');
    expect(result.items[0].officeId).toBe('office-001');
  });
});
