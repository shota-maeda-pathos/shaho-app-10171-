import { MockFirestore, makeAuth } from '../../__tests__/helpers';

let mockDb: MockFirestore;

jest.mock('../../config', () => ({
  get db() {
    return mockDb;
  },
}));

import { createDependent } from './service';

beforeEach(() => {
  mockDb = new MockFirestore();
});

const baseInput = {
  companyId: 'company-001',
  employeeId: 'emp-001',
  lastName: '山田',
  firstName: '花子',
  lastNameKana: 'ヤマダ',
  firstNameKana: 'ハナコ',
  birthDate: '1992-05-20T00:00:00.000Z',
  gender: 'female' as const,
  relationship: 'spouse',
  qualificationDate: '2020-04-01T00:00:00.000Z',
};

describe('createDependent', () => {
  it('正常に扶養家族を作成できる', async () => {
    const auth = makeAuth();
    const result = await createDependent(baseInput, auth);

    expect(result.success).toBe(true);
    expect(result.id).toBeDefined();
  });

  it('オプションフィールドのデフォルト値が適用される', async () => {
    const auth = makeAuth();
    const result = await createDependent(baseInput, auth);

    expect(result.success).toBe(true);
  });

  it('オプションフィールドを指定できる', async () => {
    const auth = makeAuth();
    const result = await createDependent(
      { ...baseInput, isDisabled: true, income: 500000, coResident: false },
      auth,
    );

    expect(result.success).toBe(true);
  });
});
