import { makeAuth, makeEmployeeDoc } from '../__tests__/helpers';
const mockDocs = new Map<string, any>();
const mockWrites = jest.fn();
jest.mock('../config', () => {
  const doc = (path: string) => ({ path, id: path.split('/').pop(), get: async () => snapshot(path) });
  const snapshot = (path: string) => ({ exists: mockDocs.has(path), data: () => mockDocs.get(path) });
  return { db: {
    doc,
    collection: (path: string) => ({ doc: (id = 'auto') => doc(`${path}/${id}`) }),
    runTransaction: async (fn: any) => {
      const ops: any[] = [];
      const tx = {
        get: async (ref: any) => { if (ops.length) throw new Error('read after write'); return snapshot(ref.path); },
        set: (ref: any, data: any) => ops.push({ ref, data, set: true }),
        update: (ref: any, data: any) => ops.push({ ref, data, set: false }),
      };
      const result = await fn(tx);
      for (const op of ops) { mockDocs.set(op.ref.path, op.set ? op.data : { ...mockDocs.get(op.ref.path), ...op.data }); mockWrites(op); }
      return result;
    },
  } };
});
import { getMonthlyInsurance } from './monthly-insurance-get/service';
import { createApprovalRequest } from '../approvals/approval-request-create/service';
import { approveApprovalRequest } from '../approvals/approval-request-approve/service';
import { rejectApprovalRequest } from '../approvals/approval-request-reject/service';
const base = 'companies/company-001/employees/emp-001';
const targetPath = `${base}/monthlyInsurance/2026-10`;
const request = { companyId: 'company-001', employeeId: 'emp-001', targetPath, targetVersion: 1, requestType: 'monthlyInsurance' as const };
const lookup = { companyId: 'company-001', employeeId: 'emp-001', yearMonth: '2026-10' };
beforeEach(() => {
  mockDocs.clear(); mockWrites.mockClear();
  mockDocs.set(base, makeEmployeeDoc());
  mockDocs.set(targetPath, { yearMonth: '2026-10', version: 1, healthGradeNumber: 22, pensionGradeNumber: 20, healthInsurance: { employeeAmount: 100 }, pensionInsurance: { employeeAmount: 200 }, totalEmployeeAmount: 300, totalEmployerAmount: 300, isConfirmed: false });
});
test('result getter returns actual totals and version', async () => {
  expect((await getMonthlyInsurance(lookup, makeAuth())).insurance).toMatchObject({ version: 1, healthEmployee: 100, totalEmployee: 300, approvalPending: false });
});
test('result getter returns null before calculation', async () => {
  mockDocs.delete(targetPath);
  expect(await getMonthlyInsurance(lookup, makeAuth())).toEqual({ insurance: null });
});
test('result getter enforces assigned office', async () => {
  await expect(getMonthlyInsurance(lookup, makeAuth({ roles: ['operator'], officeIds: [] }))).rejects.toThrow('担当事業所外');
});
test('result getter rejects deleted employees', async () => {
  mockDocs.set(base, { ...makeEmployeeDoc(), deletedAt: 'deleted' });
  await expect(getMonthlyInsurance(lookup, makeAuth())).rejects.toThrow('従業員');
});
test('monthly approval is idempotent and locks the target', async () => {
  const first = await createApprovalRequest(request, makeAuth());
  expect(mockDocs.get(targetPath).approvalPending).toBe(true);
  const writes = mockWrites.mock.calls.length;
  expect(await createApprovalRequest(request, makeAuth())).toEqual(first);
  expect(mockWrites).toHaveBeenCalledTimes(writes);
});
test('approval finalizes result and clears pending flag', async () => {
  const created = await createApprovalRequest(request, makeAuth());
  const approver = makeAuth({ uid: 'user-002' });
  await approveApprovalRequest({ companyId: 'company-001', employeeId: 'emp-001', requestId: created.id! }, approver);
  expect(mockDocs.get(targetPath)).toMatchObject({ isConfirmed: true, approvalPending: false, version: 2 });
});
test('rejection unlocks result and invalidates old version', async () => {
  const created = await createApprovalRequest(request, makeAuth());
  await rejectApprovalRequest({ companyId: 'company-001', employeeId: 'emp-001', requestId: created.id!, comment: '修正' }, makeAuth({ uid: 'user-002' }));
  expect(mockDocs.get(targetPath)).toMatchObject({ isConfirmed: false, approvalPending: false, version: 2 });
  await expect(createApprovalRequest(request, makeAuth())).rejects.toThrow('版番号');
});
test('rejects monthly target in another company or collection', async () => {
  await expect(createApprovalRequest({ ...request, targetPath: 'companies/other/employees/emp-001/monthlyInsurance/2026-10' }, makeAuth())).rejects.toThrow('パス');
  await expect(createApprovalRequest({ ...request, targetPath: `${base}/salaries/2026-10` }, makeAuth())).rejects.toThrow('パス');
});
test('stale version and already confirmed results cannot be submitted', async () => {
  mockDocs.set(targetPath, { ...mockDocs.get(targetPath), version: 2 });
  await expect(createApprovalRequest(request, makeAuth())).rejects.toThrow('版番号');
  mockDocs.set(targetPath, { ...mockDocs.get(targetPath), version: 1, isConfirmed: true });
  await expect(createApprovalRequest(request, makeAuth())).rejects.toThrow('承認済み');
});
