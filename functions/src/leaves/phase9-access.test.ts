import { makeAuth, makeEmployeeDoc } from '../__tests__/helpers';
const mockGetEmployee = jest.fn();
const mockSet = jest.fn();
const mockCollection = jest.fn();
jest.mock('../config', () => ({ db: {
  doc: () => ({ get: mockGetEmployee }),
  collection: (...args: unknown[]) => mockCollection(...args),
} }));
import { createLeave } from './leave-create/service';
import { listLeaves } from './leave-list/service';
import { createPremiumExemption } from '../exemptions/premium-exemption-create/service';
import { listPremiumExemptions } from '../exemptions/premium-exemption-list/service';
import { leaveCreateSchema } from './leave-create/schema';
const leaveInput = { companyId: 'company-001', employeeId: 'emp-001', leaveType: 'maternity' as const, expectedStartDate: '2026-10-01', expectedEndDate: '2026-11-01' };
const exemptionInput = { companyId: 'company-001', employeeId: 'emp-001', exemptionType: 'maternity' as const, startMonth: '2026-10' };
beforeEach(() => {
  jest.clearAllMocks();
  mockGetEmployee.mockResolvedValue({ exists: true, data: () => makeEmployeeDoc() });
  mockSet.mockResolvedValue(undefined);
  mockCollection.mockImplementation(() => {
    const q: any = { where: () => q, orderBy: () => q, limit: () => q, startAfter: () => q,
      get: async () => ({ docs: [] }), doc: () => ({ id: 'created', set: mockSet }) };
    return q;
  });
});
test.each([
  ['leave create', () => createLeave(leaveInput, makeAuth({ roles: ['operator'], officeIds: [] }))],
  ['leave list', () => listLeaves({ companyId: 'company-001', employeeId: 'emp-001' }, makeAuth({ roles: ['operator'], officeIds: [] }))],
  ['exemption create', () => createPremiumExemption(exemptionInput, makeAuth({ roles: ['operator'], officeIds: [] }))],
  ['exemption list', () => listPremiumExemptions({ companyId: 'company-001', employeeId: 'emp-001' }, makeAuth({ roles: ['operator'], officeIds: [] }))],
])('%s rejects employees outside assigned offices', async (_name, run) => {
  await expect((run as () => Promise<unknown>)()).rejects.toThrow('担当事業所外');
  expect(mockSet).not.toHaveBeenCalled();
});
test('assigned operator can create leave and exemption', async () => {
  const auth = makeAuth({ roles: ['operator'] });
  await expect(createLeave(leaveInput, auth)).resolves.toEqual({ id: 'created' });
  await expect(createPremiumExemption(exemptionInput, auth)).resolves.toEqual({ id: 'created' });
});
test('deleted employees cannot be listed', async () => {
  mockGetEmployee.mockResolvedValue({ exists: true, data: () => ({ deletedAt: 'deleted' }) });
  await expect(listLeaves({ companyId: 'company-001', employeeId: 'emp-001' }, makeAuth())).rejects.toThrow('従業員が見つかりません');
  await expect(listPremiumExemptions({ companyId: 'company-001', employeeId: 'emp-001' }, makeAuth())).rejects.toThrow('従業員が見つかりません');
});
test('company-wide lists do not query subcollections for unassigned employees', async () => {
  mockCollection.mockImplementation((path: string) => {
    if (!path.endsWith('/employees')) throw new Error('unassigned subcollection accessed');
    const q: any = { where: () => q, orderBy: () => q, get: async () => ({ docs: [{ id: 'other', data: () => makeEmployeeDoc({ officeId: 'other' }) }] }) };
    return q;
  });
  const auth = makeAuth({ roles: ['operator'] });
  expect((await listLeaves({ companyId: 'company-001' }, auth)).items).toEqual([]);
  expect((await listPremiumExemptions({ companyId: 'company-001' }, auth)).items).toEqual([]);
});
test('leave schema rejects invalid dates and reversed periods', () => {
  expect(leaveCreateSchema.safeParse({ ...leaveInput, expectedStartDate: '2026-02-30' }).success).toBe(false);
  expect(leaveCreateSchema.safeParse({ ...leaveInput, expectedEndDate: '2026-09-01' }).success).toBe(false);
  expect(leaveCreateSchema.safeParse(leaveInput).success).toBe(true);
});

import { premiumExemptionCreateSchema } from '../exemptions/premium-exemption-create/schema';
test.each(['2026-00', '2026-13', '2026-1', 'invalid'])('exemption schema rejects invalid month %s', (startMonth) => {
  expect(premiumExemptionCreateSchema.safeParse({ ...exemptionInput, startMonth }).success).toBe(false);
});
test('exemption accepts an open end or same-month period, rejects reversed period', () => {
  expect(premiumExemptionCreateSchema.safeParse(exemptionInput).success).toBe(true);
  expect(premiumExemptionCreateSchema.safeParse({ ...exemptionInput, endMonth: '2026-10' }).success).toBe(true);
  expect(premiumExemptionCreateSchema.safeParse({ ...exemptionInput, endMonth: '2026-09' }).success).toBe(false);
});
test('exemption rejects a missing linked leave before writing', async () => {
  mockGetEmployee.mockResolvedValueOnce({ exists: true, data: () => makeEmployeeDoc() }).mockResolvedValueOnce({ exists: false });
  await expect(createPremiumExemption({ ...exemptionInput, leaveId: 'missing' }, makeAuth())).rejects.toThrow('関連する休業');
  expect(mockSet).not.toHaveBeenCalled();
});
test('exemption rejects a cancelled linked leave before writing', async () => {
  mockGetEmployee.mockResolvedValueOnce({ exists: true, data: () => makeEmployeeDoc() }).mockResolvedValueOnce({ exists: true, data: () => ({ status: 'cancelled' }) });
  await expect(createPremiumExemption({ ...exemptionInput, leaveId: 'cancelled' }, makeAuth())).rejects.toThrow('取り消されています');
  expect(mockSet).not.toHaveBeenCalled();
});
test('exemption list returns a page and indicates more records', async () => {
  mockCollection.mockImplementation(() => {
    const q: any = { orderBy: () => q, limit: () => q, get: async () => ({ docs: Array.from({ length: 21 }, (_, i) => ({ id: `id-${i}`, data: () => ({ exemptionType: 'maternity', startMonth: '2026-10', endMonth: null, status: 'active' }) })) }) };
    return q;
  });
  const result = await listPremiumExemptions({ companyId: 'company-001', employeeId: 'emp-001', limit: 20 }, makeAuth());
  expect(result.items).toHaveLength(20);
  expect(result.hasMore).toBe(true);
  expect(result.items[0].exemptionTypeLabel).toBe('産前産後免除');
  expect(result.items[0].endMonth).toBeNull();
});

test('exemption saves approval date and monthly coverage explicitly', async () => {
  await createPremiumExemption({ ...exemptionInput, approvedDate: '2026-10-23', isMonthlyExempted: true }, makeAuth());
  const stored = mockSet.mock.calls[0][0];
  expect(stored.approvedAt.toDate().toISOString().slice(0, 10)).toBe('2026-10-23');
  expect(stored.isMonthlyExempted).toBe(true);
  expect(stored.isBonusExempted).toBe(false);
});
test('unapproved exemption registration does not create approval', async () => {
  await createPremiumExemption(exemptionInput, makeAuth());
  expect(mockSet.mock.calls[0][0].approvedAt).toBeNull();
});
