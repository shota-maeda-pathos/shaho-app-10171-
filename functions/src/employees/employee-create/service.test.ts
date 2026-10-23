import { MockFirestore, makeAuth } from '../../__tests__/helpers';

let mockDb: MockFirestore;

jest.mock('../../config', () => ({
  get db() {
    return mockDb;
  },
}));

import { createEmployee } from './service';

beforeEach(() => {
  mockDb = new MockFirestore();
});

const baseInput = {
  companyId: 'company-001',
  employeeNumber: 'EMP-100',
  lastName: '田中',
  firstName: '一郎',
  lastNameKana: 'タナカ',
  firstNameKana: 'イチロウ',
  birthDate: '1990-01-15T00:00:00.000Z',
  gender: 'male' as const,
  officeId: 'office-001',
  departmentId: null,
  hireDate: '2024-04-01T00:00:00.000Z',
};

describe('createEmployee', () => {
  it('正常に従業員を作成できる', async () => {
    const auth = makeAuth();
    mockDb.setDoc(`companies/company-001/offices/office-001`, { name: '本社' });
    mockDb.setDocNotExists(
      `companies/company-001/employeeNumbers/EMP-100`,
    );

    const result = await createEmployee(baseInput, auth);

    expect(result.success).toBe(true);
    expect(result.id).toBeDefined();
  });

  it('社員番号が重複している場合エラーになる', async () => {
    const auth = makeAuth();
    mockDb.setDoc(`companies/company-001/offices/office-001`, { name: '本社' });
    mockDb.setDoc(`companies/company-001/employeeNumbers/EMP-100`, {
      employeeId: 'existing-id',
    });

    await expect(createEmployee(baseInput, auth)).rejects.toThrow(
      'この社員番号は既に存在します',
    );
  });

  it('存在しない事業所を指定するとエラーになる', async () => {
    const auth = makeAuth();

    await expect(createEmployee(baseInput, auth)).rejects.toThrow(
      '指定された事業所が存在しません',
    );
  });

  it('operatorは担当事業所外には作成できない', async () => {
    const auth = makeAuth({
      roles: ['operator'],
      officeIds: ['office-002'],
    });
    mockDb.setDoc(`companies/company-001/offices/office-001`, { name: '本社' });

    await expect(createEmployee(baseInput, auth)).rejects.toThrow(
      '担当事業所外です',
    );
  });

  it('冪等性キーで重複リクエストを防止できる', async () => {
    const auth = makeAuth();
    const requestId = '550e8400-e29b-41d4-a716-446655440000';
    mockDb.setDoc(`companies/company-001/offices/office-001`, { name: '本社' });
    mockDb.setDoc(`companies/company-001/employeeRequests/${requestId}`, {
      employeeId: 'existing-emp-id',
    });

    const result = await createEmployee(
      { ...baseInput, requestId },
      auth,
    );

    expect(result.success).toBe(true);
    expect(result.id).toBe('existing-emp-id');
  });
});
