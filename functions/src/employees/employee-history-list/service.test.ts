import { makeAuth, makeEmployeeDoc } from '../../__tests__/helpers';
const mockGet = jest.fn();
const mockDocGet = jest.fn();
const mockStartAfter = jest.fn();
const mockOrder = jest.fn();
const mockLimit = jest.fn();
jest.mock('../../config', () => ({ db: {
  doc: (path: string) => ({ path, get: () => mockDocGet(path) }),
  collection: () => { const q: any = { orderBy: (...args: any[]) => { mockOrder(...args); return q; }, startAfter: (cursor: any) => { mockStartAfter(cursor); return q; }, limit: (limit: number) => { mockLimit(limit); return q; }, get: mockGet }; return q; },
} }));
import { listEmployeeHistory } from './service';
import { employeeHistoryListSchema } from './schema';
const input = { companyId: 'company-001', employeeId: 'emp-001', collection: 'grades' as const, limit: 20 };
beforeEach(() => {
  jest.clearAllMocks();
  mockDocGet.mockResolvedValue({ exists: true, data: () => makeEmployeeDoc() });
  mockGet.mockResolvedValue({ docs: [{ id: '2026-04', data: () => ({ effectiveMonth: '2026-04', healthGradeNumber: 22, version: 1, privateSecret: 'not for output' }) }] });
});
test('returns allowed history fields, not arbitrary stored fields', async () => {
  const result = await listEmployeeHistory(input, makeAuth());
  expect(result.items[0]).toMatchObject({ id: '2026-04', healthGradeNumber: 22, version: 1 });
  expect(result.items[0]).not.toHaveProperty('privateSecret');
  expect(mockOrder).toHaveBeenCalledWith('effectiveMonth', 'desc');
});
test('blocks unassigned offices before reading histories', async () => {
  await expect(listEmployeeHistory(input, makeAuth({ roles: ['operator'], officeIds: [] }))).rejects.toThrow('担当事業所外');
  expect(mockGet).not.toHaveBeenCalled();
});
test('blocks missing and deleted employees', async () => {
  mockDocGet.mockResolvedValueOnce({ exists: false });
  await expect(listEmployeeHistory(input, makeAuth())).rejects.toThrow('従業員');
  mockDocGet.mockResolvedValueOnce({ exists: true, data: () => ({ deletedAt: 'deleted' }) });
  await expect(listEmployeeHistory(input, makeAuth())).rejects.toThrow('従業員');
});
test('reads one extra row to determine hasMore and passes cursor', async () => {
  mockGet.mockResolvedValue({ docs: Array.from({ length: 21 }, (_, i) => ({ id: `id${i}`, data: () => ({ effectiveMonth: '2026-04' }) })) });
  const result = await listEmployeeHistory({ ...input, lastDocId: 'cursor' }, makeAuth());
  expect(result.items).toHaveLength(20); expect(result.hasMore).toBe(true); expect(result.lastDocId).toBe('id19');
  expect(mockLimit).toHaveBeenCalledWith(21); expect(mockStartAfter).toHaveBeenCalledTimes(1);
});
test.each(['employments', 'grades', 'bonuses', 'salaries'] as const)('allows only the named history %s', async collection => {
  expect(employeeHistoryListSchema.safeParse({ ...input, collection }).success).toBe(true);
  expect((await listEmployeeHistory({ ...input, collection }, makeAuth())).items).toHaveLength(1);
});
test('rejects arbitrary collections and paths', () => {
  expect(employeeHistoryListSchema.safeParse({ ...input, collection: 'secrets' }).success).toBe(false);
  expect(employeeHistoryListSchema.safeParse({ ...input, employeeId: 'other/employees/id' }).success).toBe(false);
});
