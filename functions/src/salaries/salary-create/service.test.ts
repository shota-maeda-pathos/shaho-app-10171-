import { makeAuth, makeEmployeeDoc, MockFirestore } from '../../__tests__/helpers';

let mockFirestore: MockFirestore;

jest.mock('../../config', () => {
  const { MockFirestore: MF } = jest.requireActual('../../__tests__/helpers');
  mockFirestore = new MF();
  return { db: mockFirestore };
});

import { createSalary } from './service';

describe('createSalary', () => {
  beforeEach(() => {
    mockFirestore = new (jest.requireActual('../../__tests__/helpers').MockFirestore)();
    jest.replaceProperty(require('../../config'), 'db', mockFirestore);
  });

  it('給与データを作成できる', async () => {
    const empDoc = makeEmployeeDoc();
    mockFirestore.setDoc('companies/company-001/employees/emp-001', empDoc as any);
    mockFirestore.setDocNotExists(
      'companies/company-001/employees/emp-001/salaries/2026-10',
    );

    const auth = makeAuth();
    const result = await createSalary(
      {
        companyId: 'company-001',
        employeeId: 'emp-001',
        yearMonth: '2026-10',
        paymentBasisDays: 20,
        baseSalary: 300000,
        fixedAllowances: { housing: 20000 },
      },
      auth,
    );

    expect(result.success).toBe(true);
    expect(result.id).toBe('2026-10');
  });

  it('手当を含む給与データを作成できる', async () => {
    const empDoc = makeEmployeeDoc();
    mockFirestore.setDoc('companies/company-001/employees/emp-001', empDoc as any);
    mockFirestore.setDocNotExists(
      'companies/company-001/employees/emp-001/salaries/2026-10',
    );

    const auth = makeAuth();
    const result = await createSalary(
      {
        companyId: 'company-001',
        employeeId: 'emp-001',
        yearMonth: '2026-10',
        paymentBasisDays: 20,
        baseSalary: 300000,
        fixedAllowances: { housing: 20000, commute: 15000 },
        variableAllowances: { overtime: 50000 },
      },
      auth,
    );

    expect(result.success).toBe(true);
  });

  it('同じ年月の給与データが存在する場合はエラー', async () => {
    const empDoc = makeEmployeeDoc();
    mockFirestore.setDoc('companies/company-001/employees/emp-001', empDoc as any);
    mockFirestore.setDoc(
      'companies/company-001/employees/emp-001/salaries/2026-10',
      { yearMonth: '2026-10', version: 1 },
    );

    const auth = makeAuth();
    await expect(
      createSalary(
        {
          companyId: 'company-001',
          employeeId: 'emp-001',
          yearMonth: '2026-10',
          paymentBasisDays: 20,
          baseSalary: 300000,
        },
        auth,
      ),
    ).rejects.toThrow();
  });

  it('存在しない従業員の場合はエラー', async () => {
    mockFirestore.setDocNotExists('companies/company-001/employees/emp-999');

    const auth = makeAuth();
    await expect(
      createSalary(
        {
          companyId: 'company-001',
          employeeId: 'emp-999',
          yearMonth: '2026-10',
          paymentBasisDays: 20,
          baseSalary: 300000,
        },
        auth,
      ),
    ).rejects.toThrow();
  });
});
