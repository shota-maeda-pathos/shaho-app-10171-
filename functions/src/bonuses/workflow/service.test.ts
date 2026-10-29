import { makeAuth, makeEmployeeDoc } from '../../__tests__/helpers';
const mockDocs = new Map<string, any>();
const mockWrites = jest.fn();
jest.mock('../../config', () => {
  const doc = (path: string) => ({ path, id: path.split('/').pop() });
  const snap = (path: string) => ({ exists: mockDocs.has(path), data: () => mockDocs.get(path) });
  return { db: {
    doc, collection: (path: string) => ({ doc: (id = 'auto') => doc(`${path}/${id}`) }),
    runTransaction: async (fn: any) => {
      const ops: any[] = [];
      const tx = { get: async (r: any) => { if (ops.length) throw new Error('read after write'); return snap(r.path); },
        set: (r: any, d: any) => ops.push({ path: r.path, data: d }),
        update: (r: any, d: any) => ops.push({ path: r.path, data: { ...mockDocs.get(r.path), ...d } }) };
      const result = await fn(tx); ops.forEach(op => { mockDocs.set(op.path, op.data); mockWrites(op); }); return result;
    },
  } };
});
import { getBonus, updateBonus } from './service';
import { bonusGetSchema, bonusUpdateSchema } from './schema';
import { BonusCreateSchema } from '../bonus-create/schema';
import { createApprovalRequest } from '../../approvals/approval-request-create/service';
import { approveApprovalRequest } from '../../approvals/approval-request-approve/service';
import { rejectApprovalRequest } from '../../approvals/approval-request-reject/service';
const base = 'companies/company-001/employees/emp-001';
const path = `${base}/bonuses/2026-10`, insurancePath = `${base}/bonusInsurance/2026-10`;
const lookup = { companyId: 'company-001', employeeId: 'emp-001', yearMonth: '2026-10' };
const update = { ...lookup, totalAmount: 500123, cumulativeBonusAmount: 500000, expectedVersion: 1, requestId: '00000000-0000-4000-8000-000000000001' };
const request = (type: 'bonus' | 'bonusInsurance') => ({ companyId: 'company-001', employeeId: 'emp-001', targetPath: type === 'bonus' ? path : insurancePath, targetVersion: 1, requestType: type });
beforeEach(() => {
  mockDocs.clear(); mockWrites.mockClear();
  mockDocs.set(base, makeEmployeeDoc());
  mockDocs.set(path, { yearMonth: '2026-10', version: 1, totalAmount: 400000, standardBonusAmount: 400000, cumulativeBonusAmount: 400000, isConfirmed: false, privateSecret: 'hidden' });
  mockDocs.set(insurancePath, { yearMonth: '2026-10', version: 1, bonusVersion: 1, healthInsurance: { employeeAmount: 100 }, pensionInsurance: { employeeAmount: 200 }, totalEmployeeAmount: 300, totalEmployerAmount: 400, isConfirmed: false, privateSecret: 'hidden' });
});
test('gets only allowlisted saved amounts and statuses', async () => {
  const result = await getBonus(lookup, makeAuth());
  expect(result.bonus).toMatchObject({ totalAmount: 400000, version: 1, approvalPending: false });
  expect(result.insurance).toMatchObject({ totalEmployee: 300, totalEmployer: 400, bonusVersion: 1 });
  expect(result.bonus).not.toHaveProperty('privateSecret'); expect(result.insurance).not.toHaveProperty('privateSecret');
});
test('missing source or result returns null, not fabricated zero amounts', async () => {
  mockDocs.delete(path); mockDocs.delete(insurancePath);
  expect(await getBonus(lookup, makeAuth())).toEqual({ bonus: null, insurance: null });
});
test('updates a draft using server-derived standard amount, version and receipt', async () => {
  expect(await updateBonus(update, makeAuth())).toMatchObject({ version: 2 });
  expect(mockDocs.get(path)).toMatchObject({ totalAmount: 500123, standardBonusAmount: 500000, cumulativeBonusAmount: 500000, version: 2 });
  const count = mockWrites.mock.calls.length;
  expect(await updateBonus(update, makeAuth())).toMatchObject({ version: 2 });
  expect(mockWrites).toHaveBeenCalledTimes(count);
  await expect(updateBonus({ ...update, totalAmount: 500100 }, makeAuth())).rejects.toThrow('requestId');
});
test.each(['isConfirmed', 'approvalPending'])('cannot edit %s bonus', async flag => {
  mockDocs.get(path)[flag] = true;
  await expect(updateBonus(update, makeAuth())).rejects.toThrow('変更'); expect(mockWrites).not.toHaveBeenCalled();
});
test('stale version cannot update', async () => {
  await expect(updateBonus({ ...update, expectedVersion: 9 }, makeAuth())).rejects.toMatchObject({ code: 'aborted' });
});
test.each(['bonus', 'bonusInsurance'] as const)('locks %s and deduplicates repeated submission', async type => {
  if (type === 'bonusInsurance') mockDocs.get(path).isConfirmed = true;
  const first = await createApprovalRequest(request(type), makeAuth());
  expect(mockDocs.get(request(type).targetPath).approvalPending).toBe(true);
  const count = mockWrites.mock.calls.length;
  expect(await createApprovalRequest(request(type), makeAuth())).toEqual(first);
  expect(mockWrites).toHaveBeenCalledTimes(count);
});
test.each(['bonus', 'bonusInsurance'] as const)('approval confirms %s and rejection allows a new version', async type => {
  if (type === 'bonusInsurance') mockDocs.get(path).isConfirmed = true;
  const target = request(type).targetPath;
  const reviewer = makeAuth({ uid: 'user-002' });
  const created = await createApprovalRequest(request(type), makeAuth());
  await rejectApprovalRequest({ companyId: 'company-001', employeeId: 'emp-001', requestId: created.id!, comment: '修正' }, reviewer);
  expect(mockDocs.get(target)).toMatchObject({ version: 2, approvalPending: false, isConfirmed: false });
  await expect(createApprovalRequest(request(type), makeAuth())).rejects.toThrow('版番号');
  const next = await createApprovalRequest({ ...request(type), targetVersion: 2 }, makeAuth());
  await approveApprovalRequest({ companyId: 'company-001', employeeId: 'emp-001', requestId: next.id! }, reviewer);
  expect(mockDocs.get(target)).toMatchObject({ version: 3, approvalPending: false, isConfirmed: true });
});
test('cannot submit or approve a calculation from an outdated source bonus', async () => {
  mockDocs.get(path).isConfirmed = true;
  const created = await createApprovalRequest(request('bonusInsurance'), makeAuth());
  mockDocs.get(path).version = 2;
  await expect(approveApprovalRequest({ companyId: 'company-001', employeeId: 'emp-001', requestId: created.id! }, makeAuth({ uid: 'user-002' }))).rejects.toThrow('再計算');
  await expect(createApprovalRequest(request('bonusInsurance'), makeAuth())).rejects.toThrow('再計算');
});
test.each(['bonus', 'bonusInsurance'] as const)('rejects foreign target paths for %s', async type => {
  await expect(createApprovalRequest({ ...request(type), targetPath: `companies/other/employees/emp-001/${type}/2026-10` }, makeAuth())).rejects.toThrow('パス');
  expect(mockWrites).not.toHaveBeenCalled();
});
test.each([{ roles: ['employee'] }, { roles: ['operator'], officeIds: [] }, { isLoginDisabled: true }, { isSuspended: true }])('protects the new APIs %j', async override => {
  await expect(getBonus(lookup, makeAuth(override as any))).rejects.toThrow();
  await expect(updateBonus(update, makeAuth(override as any))).rejects.toThrow();
  expect(mockWrites).not.toHaveBeenCalled();
});
test('rejects deleted employees', async () => {
  mockDocs.get(base).deletedAt = 'deleted';
  await expect(getBonus(lookup, makeAuth())).rejects.toThrow('従業員');
  await expect(updateBonus(update, makeAuth())).rejects.toThrow('従業員');
});
test('schemas validate month, IDs, precision and standard/cumulative amounts', () => {
  expect(bonusGetSchema.safeParse({ ...lookup, yearMonth: '2026-13' }).success).toBe(false);
  expect(bonusUpdateSchema.safeParse({ ...update, employeeId: 'a/b' }).success).toBe(false);
  expect(bonusUpdateSchema.safeParse({ ...update, cumulativeBonusAmount: 499000 }).success).toBe(false);
  expect(bonusUpdateSchema.safeParse({ ...update, cumulativeBonusAmount: 500001 }).success).toBe(false);
  expect(BonusCreateSchema.safeParse({ ...lookup, totalAmount: 500123, standardBonusAmount: 500000, cumulativeBonusAmount: 500000 }).success).toBe(true);
  expect(BonusCreateSchema.safeParse({ ...lookup, totalAmount: 500123, standardBonusAmount: 500123, cumulativeBonusAmount: 500000 }).success).toBe(false);
});
