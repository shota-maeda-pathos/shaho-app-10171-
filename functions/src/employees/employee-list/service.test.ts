import { Timestamp } from 'firebase-admin/firestore';
import { makeAuth, makeEmployeeDoc } from '../../__tests__/helpers';

const emp1 = makeEmployeeDoc({ employeeNumber: 'EMP-001', lastNameKana: 'アオキ' });
const emp2 = makeEmployeeDoc({ employeeNumber: 'EMP-002', lastNameKana: 'イトウ' });
const emp3 = makeEmployeeDoc({ employeeNumber: 'EMP-003', lastNameKana: 'ウエダ', isActive: false, resignationDate: Timestamp.now() });

const mockQueryDocs = jest.fn<any, any[]>();
const mockCountGet = jest.fn<any, any[]>();
let capturedQueries: string[] = [];

jest.mock('../../config', () => {
  const buildQuery = () => {
    const q: any = {
      where: jest.fn((...args: any[]) => {
        capturedQueries.push(`where:${args[0]}:${args[1]}:${args[2]}`);
        return buildQuery();
      }),
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

import { listEmployees } from './service';

beforeEach(() => {
  capturedQueries = [];
  mockCountGet.mockResolvedValue({ data: () => ({ count: 2 }) });
  mockQueryDocs.mockResolvedValue({
    docs: [
      { id: 'emp-1', data: () => emp1 },
      { id: 'emp-2', data: () => emp2 },
    ],
  });
});

describe('listEmployees', () => {
  it('生年月日が未入力の従業員がいても一覧全体を取得できる', async () => {
    mockQueryDocs.mockResolvedValue({
      docs: [
        { id: 'emp-1', data: () => emp1 },
        { id: 'emp-2', data: () => ({ ...makeEmployeeDoc(), birthDate: null }) },
      ],
    });

    const result = await listEmployees({ companyId: 'company-001' }, makeAuth({ roles: ['admin'] }));

    expect(result.items).toHaveLength(2);
    expect(result.items[0].birthDate).toBe('1990-01-15');
    expect(result.items[1].birthDate).toBe('');
  });

  it('admin は全事業所の従業員を取得できる', async () => {
    const auth = makeAuth({ roles: ['admin'] });
    const result = await listEmployees(
      { companyId: 'company-001' },
      auth,
    );

    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(result.hasMore).toBe(false);
  });

  it('担当事業所が空の operator は空の一覧を返す', async () => {
    const auth = makeAuth({ roles: ['operator'], officeIds: [] });
    const result = await listEmployees(
      { companyId: 'company-001' },
      auth,
    );

    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it('hasMore が正しく判定される', async () => {
    mockCountGet.mockResolvedValue({ data: () => ({ count: 25 }) });
    const threeDocs = [
      { id: 'emp-1', data: () => emp1 },
      { id: 'emp-2', data: () => emp2 },
      { id: 'emp-3', data: () => emp3 },
    ];
    mockQueryDocs.mockResolvedValue({ docs: threeDocs });

    const auth = makeAuth();
    const result = await listEmployees(
      { companyId: 'company-001', limit: 2 },
      auth,
    );

    expect(result.hasMore).toBe(true);
    expect(result.items).toHaveLength(2);
  });
});
