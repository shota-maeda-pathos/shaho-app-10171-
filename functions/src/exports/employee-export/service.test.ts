import { makeAuth, makeEmployeeDoc } from '../../__tests__/helpers';
import { Timestamp } from 'firebase-admin/firestore';
const mockGet = jest.fn();
const mockWhere = jest.fn();
jest.mock('../../config', () => {
  const q: any = { where: (...args: unknown[]) => { mockWhere(...args); return q; }, orderBy: () => q, get: () => mockGet() };
  const offices = { get: async () => ({ docs: [{ id: 'office-001', data: () => ({ name: '本社' }) }] }) };
  const departments = { get: async () => ({ docs: [] }) };
  return { db: { collection: (path: string) => (path.endsWith('/offices') ? offices : path.endsWith('/departments') ? departments : q) } };
});
import { exportEmployees } from './service';
const input = { companyId: 'company-001' };
beforeEach(() => { mockWhere.mockClear(); mockGet.mockReset(); });
function records(...data: any[]) {
  mockGet.mockResolvedValue({ docs: data.map(d => ({ data: () => d })) });
}
test('admin exports all offices with BOM, real dates and resignationDate', async () => {
  records(makeEmployeeDoc({ resignationDate: Timestamp.fromDate(new Date('2026-10-01')), isActive: false }), makeEmployeeDoc({ officeId: 'office-002' }));
  const result = await exportEmployees(input, makeAuth());
  expect(result.count).toBe(2);
  expect(result.csv.startsWith('\uFEFF')).toBe(true);
  expect(result.csv).toContain('1990-01-15');
  expect(result.csv).toContain('2026-10-01,退職');
  // 取込と同じ列（事業所は名前、性別は男／女）。個人番号の列はない
  expect(result.csv.split('\r\n')[0]).toContain('社員番号,姓,名,姓カナ,名カナ,生年月日,性別,事業所,部署,入社日');
  expect(result.csv).not.toContain('個人番号');
  expect(result.csv).toContain(',本社,');
  expect(result.csv).not.toContain('[object Object]');
  expect(mockWhere).toHaveBeenCalledWith('deletedAt', '==', null);
});
test('operator exports only assigned offices', async () => {
  records(makeEmployeeDoc(), makeEmployeeDoc({ officeId: 'office-002', lastName: '非公開' }));
  const result = await exportEmployees(input, makeAuth({ roles: ['operator'] }));
  expect(result.count).toBe(1);
  expect(result.csv).not.toContain('非公開');
});
test('operator with no office exports header only', async () => {
  records(makeEmployeeDoc());
  const result = await exportEmployees(input, makeAuth({ roles: ['operator'], officeIds: [] }));
  expect(result.count).toBe(0);
  expect(result.csv.split('\r\n')).toHaveLength(1);
});
test('rejects explicit requests for unassigned office', async () => {
  await expect(exportEmployees({ ...input, officeId: 'other' }, makeAuth({ roles: ['operator'] }))).rejects.toThrow('担当事業所外');
  expect(mockGet).not.toHaveBeenCalled();
});
test('escapes quotes, separators, line breaks and spreadsheet formulas', async () => {
  records(makeEmployeeDoc({ lastName: '山田,"太郎"\r\n姓', firstName: '=1+1', employeeNumber: ' @SUM(1)' }));
  const result = await exportEmployees(input, makeAuth());
  expect(result.csv).toContain('"山田,""太郎""\r\n姓"');
  expect(result.csv).toContain("'=1+1");
  expect(result.csv).toContain("' @SUM(1)");
});
test('applies active-only filter and propagates database failures', async () => {
  mockGet.mockRejectedValue(new Error('unavailable'));
  await expect(exportEmployees({ ...input, isActive: true }, makeAuth())).rejects.toThrow('unavailable');
  expect(mockWhere).toHaveBeenCalledWith('isActive', '==', true);
});
