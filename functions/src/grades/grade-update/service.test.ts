import { makeAuth, makeEmployeeDoc, makeGradeDoc, MockFirestore } from '../../__tests__/helpers';

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

import { updateGrade } from './service';

describe('updateGrade', () => {
  beforeEach(() => {
    mockFirestore = new (jest.requireActual('../../__tests__/helpers').MockFirestore)();
    jest.replaceProperty(
      require('../../config'),
      'db',
      mockFirestore,
    );
  });

  it('等級の訂正は直接書き換えず、等級表の金額で承認申請する', async () => {
    const empDoc = makeEmployeeDoc();
    const gradeDoc = makeGradeDoc();
    mockFirestore.setDoc('companies/company-001/employees/emp-001', empDoc as any);
    mockFirestore.setDoc(
      'companies/company-001/employees/emp-001/grades/2026-09',
      gradeDoc as any,
    );

    const auth = makeAuth();
    const result = await updateGrade(
      {
        companyId: 'company-001',
        employeeId: 'emp-001',
        gradeId: '2026-09',
        expectedVersion: 1,
        healthGradeNumber: 23,
        healthStandardRemuneration: 999999,
        reason: '入社時の手当の入れ漏れ',
      },
      auth,
    );

    expect(result.id).toBe('req-1');
    expect(mockCreateApproval).toHaveBeenCalledWith(expect.objectContaining({
      targetPath: 'companies/company-001/employees/emp-001/grades/2026-09',
      targetVersion: 0,
      requestType: 'grade',
      metadata: expect.objectContaining({ healthGradeNumber: 23, healthStandardRemuneration: 320000 }),
    }), auth);
  });

  it('理由がなければ申請できない', async () => {
    mockFirestore.setDoc('companies/company-001/employees/emp-001', makeEmployeeDoc() as any);
    mockFirestore.setDoc('companies/company-001/employees/emp-001/grades/2026-09', makeGradeDoc() as any);
    await expect(updateGrade({
      companyId: 'company-001', employeeId: 'emp-001', gradeId: '2026-09', expectedVersion: 1, healthGradeNumber: 23,
    }, makeAuth())).rejects.toThrow('理由');
  });

  it('バージョン不一致でエラー', async () => {
    const empDoc = makeEmployeeDoc();
    const gradeDoc = makeGradeDoc({ version: 2 });
    mockFirestore.setDoc('companies/company-001/employees/emp-001', empDoc as any);
    mockFirestore.setDoc(
      'companies/company-001/employees/emp-001/grades/2026-09',
      gradeDoc as any,
    );

    const auth = makeAuth();
    await expect(
      updateGrade(
        {
          companyId: 'company-001',
          employeeId: 'emp-001',
          gradeId: '2026-09',
          expectedVersion: 1,
          healthGradeNumber: 23,
        },
        auth,
      ),
    ).rejects.toThrow('データが更新されています');
  });

  it('存在しない等級でエラー', async () => {
    const empDoc = makeEmployeeDoc();
    mockFirestore.setDoc('companies/company-001/employees/emp-001', empDoc as any);
    mockFirestore.setDocNotExists(
      'companies/company-001/employees/emp-001/grades/2026-09',
    );

    const auth = makeAuth();
    await expect(
      updateGrade(
        {
          companyId: 'company-001',
          employeeId: 'emp-001',
          gradeId: '2026-09',
          expectedVersion: 1,
          healthGradeNumber: 23,
        },
        auth,
      ),
    ).rejects.toThrow();
  });
});
