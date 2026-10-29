import { makeAuth } from '../../__tests__/helpers';

const log1 = {
  action: 'employee.create',
  targetPath: 'companies/company-001/employees/emp-001',
  actorUid: 'user-001',
  actorName: '管理者',
  timestamp: { toDate: () => new Date('2026-10-01T10:00:00Z') },
  details: { employeeNumber: 'EMP-001' },
};
const log2 = {
  action: 'salary.update',
  targetPath: 'companies/company-001/employees/emp-001/salaries/2026-10',
  actorUid: 'user-002',
  actorName: 'オペレータ',
  timestamp: { toDate: () => new Date('2026-10-02T14:30:00Z') },
  details: {},
};

const mockQueryDocs = jest.fn<any, any[]>();

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
        get: jest.fn(async () => ({ exists: false })),
      })),
    },
  };
});

import { listAuditLogs } from './service';

beforeEach(() => {
  mockQueryDocs.mockResolvedValue({
    docs: [
      { id: 'log-001', data: () => log1 },
      { id: 'log-002', data: () => log2 },
    ],
  });
});

describe('listAuditLogs', () => {
  it('監査ログ一覧を取得できる', async () => {
    const auth = makeAuth();
    const result = await listAuditLogs(
      { companyId: 'company-001' },
      auth,
    );

    expect(result.items).toHaveLength(2);
    expect(result.items[0].action).toBe('employee.create');
    expect(result.items[0].actorName).toBe('管理者');
    expect(result.hasMore).toBe(false);
  });

  it('hasMore が正しく判定される', async () => {
    const threeDocs = [
      { id: 'log-001', data: () => log1 },
      { id: 'log-002', data: () => log2 },
      { id: 'log-003', data: () => log1 },
    ];
    mockQueryDocs.mockResolvedValue({ docs: threeDocs });

    const auth = makeAuth();
    const result = await listAuditLogs(
      { companyId: 'company-001', limit: 2 },
      auth,
    );

    expect(result.hasMore).toBe(true);
    expect(result.items).toHaveLength(2);
    expect(result.lastDocId).toBe('log-002');
  });

  it('空の場合は空配列を返す', async () => {
    mockQueryDocs.mockResolvedValue({ docs: [] });

    const auth = makeAuth();
    const result = await listAuditLogs(
      { companyId: 'company-001' },
      auth,
    );

    expect(result.items).toHaveLength(0);
    expect(result.hasMore).toBe(false);
  });
});
