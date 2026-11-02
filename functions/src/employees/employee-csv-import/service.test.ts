import { makeAuth } from '../../__tests__/helpers';
import { Timestamp } from 'firebase-admin/firestore';
import { myNumberCheckDigit } from '../../utils/check-digit';

const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockSecretsGet = jest.fn();
const mockSecretsUpdate = jest.fn();
const mockAudit = jest.fn();
const mockDecrypt = jest.fn();
const mockAssignable = jest.fn();

const employees = [
  { id: 'emp-1', data: () => ({ employeeNumber: '1', lastName: '山田', firstName: '太郎', lastNameKana: 'ヤマダ', firstNameKana: 'タロウ', birthDate: Timestamp.fromDate(new Date('1990-04-01')), gender: 'male', hireDate: Timestamp.fromDate(new Date('2020-04-01')), officeId: 'hq', isActive: true, version: 2, deletedAt: null }) },
];

jest.mock('../../config', () => ({
  db: {
    collection: (path: string) => {
      if (path.endsWith('/auditLogs')) return { add: (d: unknown) => mockAudit(d) };
      const docs = path.endsWith('/offices') ? [{ id: 'hq', data: () => ({ name: '本社' }) }]
        : path.endsWith('/departments') ? [] : employees;
      const q: any = { where: () => q, get: async () => ({ docs }) };
      return q;
    },
    doc: (path: string) => ({ path }),
  },
}));
jest.mock('../../monthly/service', () => ({
  getAllChunked: async (refs: { path: string }[]) => refs.map(r => ({ data: () => (r.path.includes('emp-1') ? { myNumberCipher: 'cipher' } : undefined) })),
}));
jest.mock('../../utils/kms', () => ({ decryptMyNumber: (...a: unknown[]) => mockDecrypt(...a) }));
jest.mock('../../offices/lifecycle', () => ({ assertAssignable: (...a: unknown[]) => mockAssignable(...a) }));
jest.mock('../employee-create/service', () => ({ createEmployee: (...a: unknown[]) => mockCreate(...a) }));
jest.mock('../employee-update/service', () => ({ updateEmployee: (...a: unknown[]) => mockUpdate(...a) }));
jest.mock('../employee-secrets/service', () => ({
  getSecrets: (...a: unknown[]) => mockSecretsGet(...a),
  updateSecrets: (...a: unknown[]) => mockSecretsUpdate(...a),
}));

import { importEmployeeCsv } from './service';

const myNo = (first11: string) => `${first11}${myNumberCheckDigit(first11)}`;
const NEW_NO = myNo('34567890123');
const CSV = [
  '社員番号,姓,名,姓カナ,名カナ,生年月日,性別,事業所,入社日,電話番号,個人番号',
  `2,佐藤,花子,サトウ,ハナコ,1995-01-02,女,本社,2026-04-01,,${NEW_NO}`,
  '1,,,,,,,,,03-1234-5678,',
].join('\r\n');

beforeEach(() => {
  jest.clearAllMocks();
  mockDecrypt.mockResolvedValue(myNo('12345678901'));
  mockAssignable.mockResolvedValue(undefined);
  mockCreate.mockResolvedValue({ success: true, id: 'emp-new' });
  mockUpdate.mockResolvedValue({ success: true });
  mockSecretsGet.mockResolvedValue({ version: 0 });
  mockSecretsUpdate.mockResolvedValue({ success: true });
});

test('確かめるだけでは書き込まず、個人番号の値を返さない', async () => {
  const result = await importEmployeeCsv({ companyId: 'company-001', csv: CSV, dryRun: true }, makeAuth());
  expect(result.creates.map(r => r.employeeNumber)).toEqual(['2']);
  expect(result.updates[0].changes).toEqual([{ label: '電話番号', from: '（空欄）', to: '03-1234-5678' }]);
  expect(JSON.stringify(result)).not.toContain(NEW_NO);
  // CSV に個人番号があるので、登録済みの番号と重複を確かめた
  expect(mockDecrypt).toHaveBeenCalledTimes(1);
  expect(mockCreate).not.toHaveBeenCalled();
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(mockAudit).not.toHaveBeenCalled();
});

test('取込では新規・更新・個人番号を書き、取込の事実を監査ログに残す', async () => {
  const result = await importEmployeeCsv({ companyId: 'company-001', csv: CSV, dryRun: false }, makeAuth());
  expect(result).toMatchObject({ created: 1, updated: 1, errors: [] });
  expect(mockCreate.mock.calls[0][0]).toMatchObject({ employeeNumber: '2', officeId: 'hq', gender: 'female', birthDate: '1995-01-02', hireDate: '2026-04-01' });
  expect(mockUpdate.mock.calls[0][0]).toMatchObject({ employeeId: 'emp-1', expectedVersion: 2, phone: '03-1234-5678' });
  expect(mockSecretsUpdate.mock.calls[0][0]).toMatchObject({ employeeId: 'emp-new', myNumber: NEW_NO, expectedVersion: 0 });
  expect(mockAudit.mock.calls[0][0]).toMatchObject({ entity: 'employeeCsvImport', changes: { created: 1, updated: 1, errors: 0 } });
  expect(JSON.stringify(mockAudit.mock.calls[0][0])).not.toContain(NEW_NO);
});

test('配属できない事業所の新規の行は誤りにし、ほかの行は取り込む', async () => {
  mockAssignable.mockRejectedValue(new Error('管轄年金事務所が未入力の事業所には配属できません'));
  const result = await importEmployeeCsv({ companyId: 'company-001', csv: CSV, dryRun: false }, makeAuth());
  expect(result.created).toBe(0);
  expect(result.updated).toBe(1);
  expect(result.errors[0]).toMatchObject({ line: 2, message: expect.stringContaining('管轄年金事務所') });
});

test('1件の書き込みが失敗しても、ほかの行は続け、失敗した行を返す', async () => {
  mockUpdate.mockRejectedValue(new Error('データが更新されています'));
  const result = await importEmployeeCsv({ companyId: 'company-001', csv: CSV, dryRun: false }, makeAuth());
  expect(result.created).toBe(1);
  expect(result.updated).toBe(0);
  expect(result.errors[0]).toMatchObject({ line: 3, message: expect.stringContaining('データが更新されています') });
});
