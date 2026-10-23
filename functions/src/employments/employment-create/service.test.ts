import { makeAuth, makeEmployeeDoc, MockFirestore } from '../../__tests__/helpers';

let mockFirestore: MockFirestore;

jest.mock('../../config', () => {
  const { MockFirestore: MF } = jest.requireActual('../../__tests__/helpers');
  mockFirestore = new MF();
  return { db: mockFirestore };
});

import { createEmployment } from './service';

describe('createEmployment', () => {
  beforeEach(() => {
    mockFirestore = new (jest.requireActual('../../__tests__/helpers').MockFirestore)();
    jest.replaceProperty(
      require('../../config'),
      'db',
      mockFirestore,
    );
  });

  it('雇用条件を作成できる', async () => {
    const empDoc = makeEmployeeDoc();
    mockFirestore.setDoc('companies/company-001/employees/emp-001', empDoc as any);

    const auth = makeAuth();
    const result = await createEmployment(
      {
        companyId: 'company-001',
        employeeId: 'emp-001',
        effectiveDate: '2020-04-01',
        employmentType: 'regular',
        weeklyHours: 40,
        monthlyDays: 20,
        baseSalary: 300000,
        socialInsuranceEnrolled: true,
        longTermCareEnrolled: false,
      },
      auth,
    );

    expect(result.success).toBe(true);
    expect(result.id).toBeDefined();
  });

  it('存在しない従業員の場合はエラー', async () => {
    mockFirestore.setDocNotExists('companies/company-001/employees/emp-999');

    const auth = makeAuth();
    await expect(
      createEmployment(
        {
          companyId: 'company-001',
          employeeId: 'emp-999',
          effectiveDate: '2020-04-01',
          employmentType: 'regular',
          weeklyHours: 40,
          monthlyDays: 20,
          baseSalary: 300000,
          socialInsuranceEnrolled: true,
          longTermCareEnrolled: false,
        },
        auth,
      ),
    ).rejects.toThrow();
  });

  it('operator は担当事業所の従業員のみ操作可能', async () => {
    const empDoc = makeEmployeeDoc({ officeId: 'office-002' });
    mockFirestore.setDoc('companies/company-001/employees/emp-001', empDoc as any);

    const auth = makeAuth({ roles: ['operator'], officeIds: ['office-001'] });
    await expect(
      createEmployment(
        {
          companyId: 'company-001',
          employeeId: 'emp-001',
          effectiveDate: '2020-04-01',
          employmentType: 'regular',
          weeklyHours: 40,
          monthlyDays: 20,
          baseSalary: 300000,
          socialInsuranceEnrolled: true,
          longTermCareEnrolled: false,
        },
        auth,
      ),
    ).rejects.toThrow();
  });
});
