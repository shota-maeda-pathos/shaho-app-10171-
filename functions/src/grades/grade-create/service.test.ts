import { makeAuth, makeEmployeeDoc, MockFirestore } from '../../__tests__/helpers';

let mockFirestore: MockFirestore;

jest.mock('../../config', () => {
  const { MockFirestore: MF } = jest.requireActual('../../__tests__/helpers');
  mockFirestore = new MF();
  return { db: mockFirestore };
});

const mockCreateApproval = jest.fn(async () => ({ success: true, id: 'req-1' }));
jest.mock('../../approvals/approval-request-create/service', () => ({
  createApprovalRequest: (...args: unknown[]) => mockCreateApproval(...(args as [])),
}));

import { createGrade } from './service';

describe('createGrade', () => {
  beforeEach(() => {
    mockFirestore = new (jest.requireActual('../../__tests__/helpers').MockFirestore)();
    jest.replaceProperty(
      require('../../config'),
      'db',
      mockFirestore,
    );
  });

  it('等級の手入力は承認申請になる', async () => {
    const empDoc = makeEmployeeDoc();
    mockFirestore.setDoc('companies/company-001/employees/emp-001', empDoc as any);
    mockFirestore.setDocNotExists(
      'companies/company-001/employees/emp-001/grades/2026-09',
    );

    const auth = makeAuth();
    const result = await createGrade(
      {
        companyId: 'company-001',
        employeeId: 'emp-001',
        effectiveMonth: '2026-09',
        healthGradeNumber: 22,
        healthStandardRemuneration: 300000,
        pensionGradeNumber: 20,
        pensionStandardRemuneration: 300000,
        determinationType: 'regular',
        reason: '前の会社の資料から転記',
      },
      auth,
    );

    expect(result.id).toBe('req-1');
    expect(mockCreateApproval).toHaveBeenCalledWith(expect.objectContaining({ requestType: 'grade', targetVersion: 0 }), auth);
  });

  it('存在しない従業員の場合はエラー', async () => {
    mockFirestore.setDocNotExists('companies/company-001/employees/emp-999');

    const auth = makeAuth();
    await expect(
      createGrade(
        {
          companyId: 'company-001',
          employeeId: 'emp-999',
          effectiveMonth: '2026-09',
          healthGradeNumber: 22,
          healthStandardRemuneration: 300000,
          pensionGradeNumber: 20,
          pensionStandardRemuneration: 300000,
          determinationType: 'regular',
        },
        auth,
      ),
    ).rejects.toThrow();
  });

  it('同じ適用月の等級が存在する場合はエラー', async () => {
    const empDoc = makeEmployeeDoc();
    mockFirestore.setDoc('companies/company-001/employees/emp-001', empDoc as any);
    mockFirestore.setDoc(
      'companies/company-001/employees/emp-001/grades/2026-09',
      { effectiveMonth: '2026-09', version: 1 },
    );

    const auth = makeAuth();
    await expect(
      createGrade(
        {
          companyId: 'company-001',
          employeeId: 'emp-001',
          effectiveMonth: '2026-09',
          healthGradeNumber: 22,
          healthStandardRemuneration: 300000,
          pensionGradeNumber: 20,
          pensionStandardRemuneration: 300000,
          determinationType: 'regular',
        },
        auth,
      ),
    ).rejects.toThrow();
  });
});
