import { makeAuth, makeEmployeeDoc, makeSalaryDoc } from '../../__tests__/helpers';

const emp1 = makeEmployeeDoc({ employeeNumber: 'EMP-001' });
const emp2 = makeEmployeeDoc({ employeeNumber: 'EMP-002' });
const salary1 = makeSalaryDoc({ baseSalary: 300000, totalSalary: 335000, isConfirmed: true });

const mockQueryDocs = jest.fn<any, any[]>();
const mockSalaryGet = jest.fn<any, any[]>();

jest.mock('../../config', () => {
  const buildQuery = () => {
    const q: any = {
      where: jest.fn(() => buildQuery()),
      orderBy: jest.fn(() => buildQuery()),
      startAfter: jest.fn(() => buildQuery()),
      limit: jest.fn(() => buildQuery()),
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
        get: jest.fn(() => mockSalaryGet()),
      })),
    },
  };
});

import { listSalaries } from './service';

beforeEach(() => {
  mockQueryDocs.mockResolvedValue({
    docs: [
      { id: 'emp-001', data: () => emp1 },
      { id: 'emp-002', data: () => emp2 },
    ],
  });
  mockSalaryGet.mockImplementation(async () => ({
    exists: true,
    data: () => salary1,
  }));
});

describe('listSalaries', () => {
  it('給与一覧を取得できる', async () => {
    const auth = makeAuth();
    const result = await listSalaries(
      { companyId: 'company-001', yearMonth: '2026-10' },
      auth,
    );

    expect(result.items).toHaveLength(2);
    expect(result.items[0].baseSalary).toBe(300000);
    expect(result.items[0].isConfirmed).toBe(true);
    expect(result.hasMore).toBe(false);
  });

  it('給与データがない従業員はゼロで表示', async () => {
    mockSalaryGet.mockResolvedValue({ exists: false, data: () => undefined });

    const auth = makeAuth();
    const result = await listSalaries(
      { companyId: 'company-001', yearMonth: '2026-10' },
      auth,
    );

    expect(result.items[0].baseSalary).toBe(0);
    expect(result.items[0].isConfirmed).toBe(false);
  });

  it('hasMore が正しく判定される', async () => {
    const threeDocs = [
      { id: 'emp-001', data: () => emp1 },
      { id: 'emp-002', data: () => emp2 },
      { id: 'emp-003', data: () => emp1 },
    ];
    mockQueryDocs.mockResolvedValue({ docs: threeDocs });

    const auth = makeAuth();
    const result = await listSalaries(
      { companyId: 'company-001', yearMonth: '2026-10', limit: 2 },
      auth,
    );

    expect(result.hasMore).toBe(true);
    expect(result.items).toHaveLength(2);
  });
});

test('operator without an assigned office never reads salaries', async () => {
  mockQueryDocs.mockClear(); mockSalaryGet.mockClear();
  expect(await listSalaries({ companyId: 'company-001', yearMonth: '2026-10' }, makeAuth({ roles: ['operator'], officeIds: [] }))).toEqual({ items: [], hasMore: false });
  expect(mockQueryDocs).not.toHaveBeenCalled(); expect(mockSalaryGet).not.toHaveBeenCalled();
});
