import { makeAuth, makeEmployeeDoc, makeSalaryDoc, MockFirestore } from '../../__tests__/helpers';

let mockFirestore: MockFirestore;

jest.mock('../../config', () => {
  const { MockFirestore: MF } = jest.requireActual('../../__tests__/helpers');
  mockFirestore = new MF();
  return { db: mockFirestore };
});

import { updateSalary } from './service';

describe('updateSalary', () => {
  beforeEach(() => {
    mockFirestore = new (jest.requireActual('../../__tests__/helpers').MockFirestore)();
    jest.replaceProperty(require('../../config'), 'db', mockFirestore);
  });

  it('未承認の給与データを更新できる', async () => {
    const empDoc = makeEmployeeDoc();
    const salaryDoc = makeSalaryDoc();
    mockFirestore.setDoc('companies/company-001/employees/emp-001', empDoc as any);
    mockFirestore.setDoc(
      'companies/company-001/employees/emp-001/salaries/2026-10',
      salaryDoc as any,
    );

    const auth = makeAuth();
    const result = await updateSalary(
      {
        companyId: 'company-001',
        employeeId: 'emp-001',
        salaryId: '2026-10',
        expectedVersion: 1,
        baseSalary: 320000,
      },
      auth,
    );

    expect(result.success).toBe(true);
    expect(result.id).toBe('2026-10');
  });

  it('承認済みの給与データは編集不可', async () => {
    const empDoc = makeEmployeeDoc();
    const salaryDoc = makeSalaryDoc({ isConfirmed: true });
    mockFirestore.setDoc('companies/company-001/employees/emp-001', empDoc as any);
    mockFirestore.setDoc(
      'companies/company-001/employees/emp-001/salaries/2026-10',
      salaryDoc as any,
    );

    const auth = makeAuth();
    await expect(
      updateSalary(
        {
          companyId: 'company-001',
          employeeId: 'emp-001',
          salaryId: '2026-10',
          expectedVersion: 1,
          baseSalary: 320000,
        },
        auth,
      ),
    ).rejects.toThrow('承認済み');
  });

  it('バージョン不一致でエラー', async () => {
    const empDoc = makeEmployeeDoc();
    const salaryDoc = makeSalaryDoc({ version: 2 });
    mockFirestore.setDoc('companies/company-001/employees/emp-001', empDoc as any);
    mockFirestore.setDoc(
      'companies/company-001/employees/emp-001/salaries/2026-10',
      salaryDoc as any,
    );

    const auth = makeAuth();
    await expect(
      updateSalary(
        {
          companyId: 'company-001',
          employeeId: 'emp-001',
          salaryId: '2026-10',
          expectedVersion: 1,
          baseSalary: 320000,
        },
        auth,
      ),
    ).rejects.toThrow('データが更新されています');
  });
});
