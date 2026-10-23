import { makeAuth, makeEmployeeDoc, makeGradeDoc, MockFirestore } from '../../__tests__/helpers';

let mockFirestore: MockFirestore;

jest.mock('../../config', () => {
  const { MockFirestore: MF } = jest.requireActual('../../__tests__/helpers');
  mockFirestore = new MF();
  return { db: mockFirestore };
});

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

  it('等級を更新できる', async () => {
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
        healthStandardRemuneration: 320000,
      },
      auth,
    );

    expect(result.success).toBe(true);
    expect(result.id).toBe('2026-09');
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
