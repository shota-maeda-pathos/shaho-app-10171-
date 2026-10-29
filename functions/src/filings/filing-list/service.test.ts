import { makeAuth, makeEmployeeDoc, makeFilingDoc } from '../../__tests__/helpers';

const emp1 = makeEmployeeDoc({ employeeNumber: 'EMP-001', officeId: 'office-001' });
const filing1 = makeFilingDoc({ filingType: 'acquisitionNotification', workflowStatus: 'approved', submissionStatus: 'submitted' });
const filing2 = makeFilingDoc({ filingType: 'lossNotification', workflowStatus: 'draft', submissionStatus: 'notSubmitted' });

const mockEmpQueryDocs = jest.fn<any, any[]>();
const mockFilingQueryDocs = jest.fn<any, any[]>();

jest.mock('../../config', () => {
  const buildQuery = (isEmpQuery: boolean) => {
    const q: any = {
      where: jest.fn(() => buildQuery(isEmpQuery)),
      orderBy: jest.fn(() => buildQuery(isEmpQuery)),
      limit: jest.fn(() => buildQuery(isEmpQuery)),
      get: isEmpQuery ? mockEmpQueryDocs : mockFilingQueryDocs,
    };
    return q;
  };

  return {
    db: {
      collection: jest.fn((path: string) => {
        const isEmp = path.endsWith('/employees');
        return buildQuery(isEmp);
      }),
      doc: jest.fn((path: string) => ({
        path,
        id: path.split('/').pop(),
        get: jest.fn(async () => ({
          exists: true,
          data: () => emp1,
        })),
      })),
    },
  };
});

import { listFilings } from './service';

beforeEach(() => {
  mockEmpQueryDocs.mockResolvedValue({
    docs: [{ id: 'emp-001', data: () => emp1 }],
  });
  mockFilingQueryDocs.mockResolvedValue({
    docs: [
      { id: 'filing-001', data: () => filing1 },
      { id: 'filing-002', data: () => filing2 },
    ],
  });
});

describe('listFilings', () => {
  it('届出一覧を取得できる', async () => {
    const auth = makeAuth();
    const result = await listFilings(
      { companyId: 'company-001' },
      auth,
    );

    expect(result.items).toHaveLength(2);
    expect(result.items[0].filingType).toBe('acquisitionNotification');
    expect(result.items[0].employeeName).toBe('山田 太郎');
  });

  it('特定従業員の届出を取得できる', async () => {
    mockFilingQueryDocs.mockResolvedValue({
      docs: [{ id: 'filing-001', data: () => filing1 }],
    });

    const auth = makeAuth();
    const result = await listFilings(
      { companyId: 'company-001', employeeId: 'emp-001' },
      auth,
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0].employeeId).toBe('emp-001');
  });

  it('operator は担当事業所外の届出をスキップ', async () => {
    mockEmpQueryDocs.mockResolvedValue({
      docs: [
        { id: 'emp-001', data: () => makeEmployeeDoc({ officeId: 'office-002' }) },
      ],
    });

    const auth = makeAuth({ roles: ['operator'], officeIds: ['office-001'] });
    const result = await listFilings(
      { companyId: 'company-001' },
      auth,
    );

    expect(result.items).toHaveLength(0);
  });
});
