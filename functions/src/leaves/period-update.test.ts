import { makeAuth, makeEmployeeDoc } from '../__tests__/helpers';
const mockDocs = new Map<string, any>();
const mockWrites = jest.fn();
jest.mock('../config', () => {
  const doc = (path: string) => ({ path, id: path.split('/').pop() });
  return { db: {
    doc, collection: (path: string) => ({ doc: () => doc(`${path}/audit-${mockWrites.mock.calls.length}`) }),
    runTransaction: async (fn: any) => {
      const ops: any[] = [];
      const tx = {
        get: async (r: any) => { if (ops.length) throw new Error('read after write'); return { exists: mockDocs.has(r.path), data: () => mockDocs.get(r.path) }; },
        set: (r: any, d: any) => ops.push({ r, d, set: true }),
        update: (r: any, d: any) => ops.push({ r, d, set: false }),
      };
      const result = await fn(tx);
      for (const op of ops) { mockDocs.set(op.r.path, op.set ? op.d : { ...mockDocs.get(op.r.path), ...op.d }); mockWrites(op); }
      return result;
    },
  } };
});
import { updateLeave } from './leave-update/service';
import { leaveUpdateSchema } from './leave-update/schema';
import { updatePremiumExemption } from '../exemptions/premium-exemption-update/service';
import { premiumExemptionUpdateSchema } from '../exemptions/premium-exemption-update/schema';
const base = 'companies/company-001/employees/emp-001';
const leavePath = `${base}/leaves/leave-1`, exemptionPath = `${base}/premiumExemptions/exemption-1`;
const requestId = '11111111-1111-4111-8111-111111111111';
const leave = { companyId: 'company-001', employeeId: 'emp-001', leaveId: 'leave-1', expectedVersion: 1, requestId, action: 'start' as const, actualDate: '2026-10-01' };
const exemption = { companyId: 'company-001', employeeId: 'emp-001', exemptionId: 'exemption-1', expectedVersion: 1, requestId, endMonth: '2026-10' };
beforeEach(() => {
  mockDocs.clear(); mockWrites.mockClear();
  mockDocs.set(base, makeEmployeeDoc());
  mockDocs.set(leavePath, { status: 'planned', version: 1, actualStartDate: null, actualEndDate: null });
  mockDocs.set(exemptionPath, { status: 'active', version: 1, startMonth: '2026-09', endMonth: null, approvedAt: 'old-approval', isMonthlyExempted: true });
});
test('starts planned leave with version increment and audit', async () => {
  await updateLeave(leave, makeAuth());
  expect(mockDocs.get(leavePath)).toMatchObject({ status: 'active', version: 2, actualStartDate: '2026-10-01' });
  expect([...mockDocs.entries()].some(([p, d]) => p.includes('/auditLogs/') && d.action === 'start')).toBe(true);
});
test('ends active leave, keeps start date, and does not change exemptions', async () => {
  mockDocs.set(leavePath, { status: 'active', version: 1, actualStartDate: '2026-09-01' });
  await updateLeave({ ...leave, action: 'end' }, makeAuth());
  expect(mockDocs.get(leavePath)).toMatchObject({ status: 'ended', actualStartDate: '2026-09-01', actualEndDate: '2026-10-01' });
  expect(mockDocs.get(exemptionPath).endMonth).toBeNull();
});
test('end date cannot precede actual start', async () => {
  mockDocs.set(leavePath, { status: 'active', version: 1, actualStartDate: '2026-10-02' });
  await expect(updateLeave({ ...leave, action: 'end' }, makeAuth())).rejects.toThrow('開始日以降');
  expect(mockWrites).not.toHaveBeenCalled();
});
test.each(['active', 'ended', 'cancelled'])('cannot start leave in %s state', async status => {
  mockDocs.set(leavePath, { status, version: 1 });
  await expect(updateLeave(leave, makeAuth())).rejects.toThrow('予定');
});
test('cannot end planned leave', async () => {
  await expect(updateLeave({ ...leave, action: 'end' }, makeAuth())).rejects.toThrow('休業中');
});
test('stale versions reject both updates without writing', async () => {
  await expect(updateLeave({ ...leave, expectedVersion: 2 }, makeAuth())).rejects.toThrow('再読み込み');
  await expect(updatePremiumExemption({ ...exemption, expectedVersion: 2 }, makeAuth())).rejects.toThrow('再読み込み');
  expect(mockWrites).not.toHaveBeenCalled();
});
test('replayed request returns original result without duplicate writes', async () => {
  const first = await updateLeave(leave, makeAuth());
  const count = mockWrites.mock.calls.length;
  expect(await updateLeave(leave, makeAuth())).toEqual(first);
  expect(mockWrites).toHaveBeenCalledTimes(count);
  await expect(updateLeave({ ...leave, actualDate: '2026-10-02' }, makeAuth())).rejects.toThrow('requestId');
});
test('updates inclusive end month and re-records approval without erasing historical coverage', async () => {
  await updatePremiumExemption({ ...exemption, approvedDate: '2026-10-23' }, makeAuth());
  const stored = mockDocs.get(exemptionPath);
  expect(stored).toMatchObject({ status: 'active', startMonth: '2026-09', endMonth: '2026-10', version: 2 });
  expect(stored.approvedAt.toDate().toISOString().slice(0, 10)).toBe('2026-10-23');
});
test('period change without new approval removes old approval', async () => {
  await updatePremiumExemption(exemption, makeAuth());
  expect(mockDocs.get(exemptionPath).approvedAt).toBeNull();
});
test('end month cannot precede start month', async () => {
  await expect(updatePremiumExemption({ ...exemption, endMonth: '2026-08' }, makeAuth())).rejects.toThrow('開始月以降');
  expect(mockWrites).not.toHaveBeenCalled();
});
test('end month can be changed back to unknown', async () => {
  await updatePremiumExemption({ ...exemption, endMonth: null }, makeAuth());
  expect(mockDocs.get(exemptionPath).endMonth).toBeNull();
});
test('exemption replay is idempotent', async () => {
  const result = await updatePremiumExemption(exemption, makeAuth());
  const writes = mockWrites.mock.calls.length;
  expect(await updatePremiumExemption(exemption, makeAuth())).toEqual(result);
  expect(mockWrites).toHaveBeenCalledTimes(writes);
});
test('bonus eligibility update requires re-recording approval and audits the change', async () => {
  mockDocs.get(exemptionPath).exemptionType = 'childcare';
  const result = await updatePremiumExemption({ ...exemption, isBonusExempted: true, approvedDate: '2026-10-23' }, makeAuth());
  expect(result).toMatchObject({ isBonusExempted: true, version: 2 });
  expect(mockDocs.get(exemptionPath)).toMatchObject({ isBonusExempted: true });
  await expect(updatePremiumExemption({ ...exemption, isBonusExempted: false, approvedDate: '2026-10-23' }, makeAuth())).rejects.toThrow('requestId');
});
test('omitted bonus eligibility preserves the old value but missing approval clears approval', async () => {
  mockDocs.get(exemptionPath).isBonusExempted = true;
  await updatePremiumExemption(exemption, makeAuth());
  expect(mockDocs.get(exemptionPath)).toMatchObject({ isBonusExempted: true, approvedAt: null });
});
test('reduced-hours records cannot be changed to bonus exemption', async () => {
  mockDocs.get(exemptionPath).exemptionType = 'childcare_reduced';
  await expect(updatePremiumExemption({ ...exemption, isBonusExempted: true }, makeAuth())).rejects.toThrow('免除種別');
  expect(mockWrites).not.toHaveBeenCalled();
});
test.each([
  { roles: ['viewer'] }, { roles: ['operator'], officeIds: [] }, { isSuspended: true }, { isLoginDisabled: true },
])('blocks unauthorized updates %j', async override => {
  const auth = makeAuth(override as any);
  await expect(updateLeave(leave, auth)).rejects.toThrow();
  await expect(updatePremiumExemption(exemption, auth)).rejects.toThrow();
  expect(mockWrites).not.toHaveBeenCalled();
});
test('deleted employee cannot be updated', async () => {
  mockDocs.set(base, { ...makeEmployeeDoc(), deletedAt: 'deleted' });
  await expect(updateLeave(leave, makeAuth())).rejects.toThrow('従業員');
  await expect(updatePremiumExemption(exemption, makeAuth())).rejects.toThrow('従業員');
});
test('schemas reject invalid dates, paths, months and missing versions', () => {
  expect(leaveUpdateSchema.safeParse({ ...leave, actualDate: '2026-02-30' }).success).toBe(false);
  expect(leaveUpdateSchema.safeParse({ ...leave, leaveId: 'other/id' }).success).toBe(false);
  expect(leaveUpdateSchema.safeParse({ ...leave, expectedVersion: undefined }).success).toBe(false);
  expect(premiumExemptionUpdateSchema.safeParse({ ...exemption, endMonth: '2026-13' }).success).toBe(false);
  expect(premiumExemptionUpdateSchema.safeParse({ ...exemption, approvedDate: '2026-02-30' }).success).toBe(false);
});
