import { makeAuth, makeEmployeeDoc, MockFirestore } from '../../__tests__/helpers';

let mockFirestore: MockFirestore;

jest.mock('../../config', () => {
  const { MockFirestore: MF } = jest.requireActual('../../__tests__/helpers');
  mockFirestore = new MF();
  return { db: mockFirestore };
});

import { createBonus } from './service';

describe('createBonus', () => {
  beforeEach(() => {
    mockFirestore = new (jest.requireActual('../../__tests__/helpers').MockFirestore)();
    jest.replaceProperty(require('../../config'), 'db', mockFirestore);
  });

  it('賞与データを作成できる', async () => {
    const empDoc = makeEmployeeDoc();
    mockFirestore.setDoc('companies/company-001/employees/emp-001', empDoc as any);
    mockFirestore.setDocNotExists(
      'companies/company-001/employees/emp-001/bonuses/2026-06',
    );

    const auth = makeAuth();
    const result = await createBonus(
      {
        companyId: 'company-001',
        employeeId: 'emp-001',
        yearMonth: '2026-06',
        totalAmount: 500000,
        standardBonusAmount: 500000,
        cumulativeBonusAmount: 500000,
      },
      auth,
    );

    expect(result.success).toBe(true);
    expect(result.id).toBe('2026-06');
  });

  it('同じ年月の賞与データが存在する場合はエラー', async () => {
    const empDoc = makeEmployeeDoc();
    mockFirestore.setDoc('companies/company-001/employees/emp-001', empDoc as any);
    mockFirestore.setDoc(
      'companies/company-001/employees/emp-001/bonuses/2026-06',
      { yearMonth: '2026-06', version: 1 },
    );

    const auth = makeAuth();
    await expect(
      createBonus(
        {
          companyId: 'company-001',
          employeeId: 'emp-001',
          yearMonth: '2026-06',
          totalAmount: 500000,
          standardBonusAmount: 500000,
          cumulativeBonusAmount: 500000,
        },
        auth,
      ),
    ).rejects.toThrow();
  });

  it('存在しない従業員の場合はエラー', async () => {
    mockFirestore.setDocNotExists('companies/company-001/employees/emp-999');

    const auth = makeAuth();
    await expect(
      createBonus(
        {
          companyId: 'company-001',
          employeeId: 'emp-999',
          yearMonth: '2026-06',
          totalAmount: 500000,
          standardBonusAmount: 500000,
          cumulativeBonusAmount: 500000,
        },
        auth,
      ),
    ).rejects.toThrow();
  });
});
