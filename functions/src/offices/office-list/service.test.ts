import { makeAuth, makeOfficeDoc } from '../../__tests__/helpers';

const office1 = makeOfficeDoc({ name: '本社' });
const office2 = makeOfficeDoc({ name: '大阪支社', prefectureCode: '27' });


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

import { listOffices } from './service';

beforeEach(() => {
  mockQueryDocs.mockResolvedValue({
    docs: [
      { id: 'office-001', data: () => office1 },
      { id: 'office-002', data: () => office2 },
    ],
  });
});

describe('listOffices', () => {
  it('admin は全事業所を取得できる', async () => {
    const auth = makeAuth({ roles: ['admin'] });
    const result = await listOffices(
      { companyId: 'company-001' },
      auth,
    );

    expect(result.items).toHaveLength(2);
    // 並び順は事業所名の日本語順（実装の sort）。名前で引いて確かめる
    const names = result.items.map((item: any) => item.name);
    expect(names).toEqual(['本社', '大阪支社'].sort((a, b) => a.localeCompare(b, 'ja')));
    expect(result.items.find((item: any) => item.name === '大阪支社')?.prefectureCode).toBe('27');
  });

  it('担当事業所が空の operator は空の一覧を返す', async () => {
    const auth = makeAuth({ roles: ['operator'], officeIds: [] });
    const result = await listOffices(
      { companyId: 'company-001' },
      auth,
    );

    expect(result.items).toHaveLength(0);
  });

  it('レスポンスに必要なフィールドが含まれる', async () => {
    mockQueryDocs.mockResolvedValue({
      docs: [{ id: 'office-001', data: () => office1 }],
    });

    const auth = makeAuth();
    const result = await listOffices(
      { companyId: 'company-001' },
      auth,
    );

    const item = result.items[0];
    expect(item.id).toBe('office-001');
    expect(item.closingDay).toBe(0);
    expect(item.paymentMonth).toBe('current');
    expect(item.deductionMethod).toBe('current');
    expect(item.createdAt).toBeDefined();
  });
});
