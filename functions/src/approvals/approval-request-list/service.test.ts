import { makeAuth, makeEmployeeDoc, makeApprovalRequestDoc } from '../../__tests__/helpers';

const emp1 = makeEmployeeDoc({ employeeNumber: 'EMP-001', officeId: 'office-001' });
const req1 = makeApprovalRequestDoc({ requestType: 'salary', status: 'pending' });
const req2 = makeApprovalRequestDoc({ requestType: 'filing', status: 'approved' });

const mockEmpQueryDocs = jest.fn<any, any[]>();
const mockReqQueryDocs = jest.fn<any, any[]>();

jest.mock('../../config', () => {
  const buildQuery = (isEmpQuery: boolean) => {
    const q: any = {
      where: jest.fn(() => buildQuery(isEmpQuery)),
      orderBy: jest.fn(() => buildQuery(isEmpQuery)),
      limit: jest.fn(() => buildQuery(isEmpQuery)),
      get: isEmpQuery ? mockEmpQueryDocs : mockReqQueryDocs,
    };
    return q;
  };

  return {
    db: {
      collection: jest.fn((path: string) => {
        const isEmp = path.endsWith('/employees');
        return buildQuery(isEmp);
      }),
    },
  };
});

import { listApprovalRequests } from './service';

beforeEach(() => {
  mockEmpQueryDocs.mockResolvedValue({
    docs: [{ id: 'emp-001', data: () => emp1 }],
  });
  mockReqQueryDocs.mockResolvedValue({
    docs: [
      { id: 'req-001', data: () => req1 },
      { id: 'req-002', data: () => req2 },
    ],
  });
});

describe('listApprovalRequests', () => {
  it('承認リクエスト一覧を取得できる', async () => {
    const auth = makeAuth();
    const result = await listApprovalRequests(
      { companyId: 'company-001' },
      auth,
    );

    expect(result.items).toHaveLength(2);
    expect(result.items[0].requestType).toBe('salary');
    expect(result.items[0].employeeName).toBe('山田 太郎');
  });

  it('operator は担当事業所外をスキップ', async () => {
    mockEmpQueryDocs.mockResolvedValue({
      docs: [
        { id: 'emp-001', data: () => makeEmployeeDoc({ officeId: 'office-002' }) },
      ],
    });

    const auth = makeAuth({ roles: ['operator'], officeIds: ['office-001'] });
    const result = await listApprovalRequests(
      { companyId: 'company-001' },
      auth,
    );

    expect(result.items).toHaveLength(0);
  });

  it('limit は処理済みの件数に効き、承認待ちは件数で切らない', async () => {
    const req3 = makeApprovalRequestDoc({ requestType: 'bonus', status: 'approved' });
    mockReqQueryDocs.mockResolvedValue({
      docs: [
        { id: 'req-001', data: () => req1 },
        { id: 'req-002', data: () => req2 },
        { id: 'req-003', data: () => req3 },
      ],
    });

    const auth = makeAuth();
    const result = await listApprovalRequests(
      { companyId: 'company-001', limit: 1 },
      auth,
    );

    expect(result.items.map(i => i.status)).toEqual(['pending', 'approved']);
  });

  it('承認待ちと処理済みを両方読んでも同じ申請を重ねない', async () => {
    const result = await listApprovalRequests({ companyId: 'company-001' }, makeAuth());
    expect(result.items.map(i => i.id)).toEqual(['req-001', 'req-002']);
  });
});
