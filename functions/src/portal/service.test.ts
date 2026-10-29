import { makeAuth, makeEmployeeDoc, makeSalaryDoc } from '../__tests__/helpers';
const mockDocGet = jest.fn();
const mockCollection = jest.fn();
const mockGet = jest.fn();
const mockOrder = jest.fn();
const mockLimit = jest.fn();
const mockStartAfter = jest.fn();
jest.mock('../config', () => ({ db: {
  doc: (path: string) => ({ get: () => mockDocGet(path) }),
  collection: (path: string) => {
    mockCollection(path);
    const q: any = {
      orderBy: (...args: unknown[]) => { mockOrder(...args); return q; },
      limit: (n: number) => { mockLimit(n); return q; },
      startAfter: (cursor: unknown) => { mockStartAfter(cursor); return q; },
      get: mockGet,
    };
    return q;
  },
} }));
import { getPortalOverview, getPortalPayslip } from './service';
import { portalOverviewSchema, portalPayslipGetSchema } from './schema';

const root = 'companies/company-001/employees/emp-001';
const auth = () => makeAuth({ employeeId: 'emp-001', roles: ['employee'], officeIds: [] });
const input = { companyId: 'company-001', limit: 12 };
const detail = { companyId: 'company-001', yearMonth: '2026-10' };
let docs: Map<string, Record<string, unknown>>;
const row = (id: string, confirmed: boolean) => ({ id, data: () => ({ ...makeSalaryDoc({ yearMonth: id, isConfirmed: confirmed }), isPublished: true }) });
beforeEach(() => {
  jest.clearAllMocks();
  docs = new Map([
    [root, { ...makeEmployeeDoc({ userId: 'user-001' }), secret: 'private' }],
    ['companies/company-001/offices/office-001', { name: '本社' }],
    [`${root}/salaries/2026-10`, { ...makeSalaryDoc({ isConfirmed: true }), isPublished: true, privateNote: 'private' }],
    [`${root}/monthlyInsurance/2026-10`, {
      yearMonth: '2026-10', isConfirmed: true,
      healthInsurance: { employeeAmount: 16000, employerAmount: 16000 },
      pensionInsurance: { employeeAmount: 30000 }, longTermCareInsurance: null,
      childSupportContribution: { employeeAmount: 0, employerAmount: 1080 },
      childSupportPayment: { employeeAmount: 500, employerAmount: 500 }, totalEmployeeAmount: 46500,
      secret: 'private',
    }],
  ]);
  mockDocGet.mockImplementation(async (path: string) => ({ exists: docs.has(path), id: path.split('/').pop(), data: () => docs.get(path) }));
  mockGet.mockResolvedValue({ docs: [row('2026-10', true)] });
});

test('unlinked profile returns an explicit state without searching employee records', async () => {
  expect(await getPortalOverview(input, makeAuth())).toMatchObject({ linked: false, payslips: [] });
  expect(mockDocGet).not.toHaveBeenCalled();
  expect(mockCollection).not.toHaveBeenCalled();
  await expect(getPortalPayslip(detail, makeAuth())).rejects.toMatchObject({ code: 'failed-precondition' });
});
test.each(['employee', 'admin'] as const)('ownership cannot be bypassed by role %s', async role => {
  docs.get(root)!.userId = 'another-user';
  await expect(getPortalOverview(input, makeAuth({ employeeId: 'emp-001', roles: [role] }))).rejects.toMatchObject({ code: 'permission-denied' });
  expect(mockCollection).not.toHaveBeenCalled();
  expect(mockDocGet).toHaveBeenCalledTimes(1);
});
test('login-disabled users cannot read their own data', async () => {
  await expect(getPortalPayslip(detail, { ...auth(), isLoginDisabled: true })).rejects.toMatchObject({ code: 'permission-denied' });
  expect(mockDocGet).not.toHaveBeenCalled();
});
test('management suspension and retirement still permit own approved records', async () => {
  docs.get(root)!.isActive = false;
  const result = await getPortalOverview(input, { ...auth(), isSuspended: true });
  expect(result.profile).toMatchObject({ isActive: false });
  expect(result.payslips).toHaveLength(1);
});
test.each(['missing', 'deleted'])('denies %s employee records', async state => {
  if (state === 'missing') docs.delete(root); else docs.get(root)!.deletedAt = 'deleted';
  await expect(getPortalPayslip(detail, auth())).rejects.toMatchObject({ code: 'not-found' });
  expect(mockDocGet).toHaveBeenCalledTimes(1);
});
test('rejects path injection in stored employee link before reading data', async () => {
  await expect(getPortalOverview(input, { ...auth(), employeeId: 'other/employees/id' })).rejects.toMatchObject({ code: 'permission-denied' });
  expect(mockDocGet).not.toHaveBeenCalled();
});
test('returns allowlisted actual amounts and only queries the authenticated employee', async () => {
  const result = await getPortalOverview(input, auth());
  expect(result.profile).toMatchObject({ employeeName: '山田 太郎', officeName: '本社', hireDate: '2020-04-01' });
  expect(result.profile).not.toHaveProperty('secret');
  expect(result.payslips[0]).toMatchObject({ totalSalary: 335000, insurance: { health: 16000, pension: 30000, longTermCare: 0, childSupportPayment: 500, totalEmployee: 46500 } });
  expect(result.payslips[0].insurance).not.toHaveProperty('childSupport');
  expect(result.payslips[0].insurance).not.toHaveProperty('childSupportContribution');
  expect(result.payslips[0]).not.toHaveProperty('netPay');
  expect(result.payslips[0].insurance).not.toHaveProperty('secret');
  expect(mockCollection).toHaveBeenCalledWith(`${root}/salaries`);
  expect(mockOrder).toHaveBeenCalledWith('yearMonth', 'desc');
  expect(mockLimit).toHaveBeenCalledWith(13);
});
test('raw-month pagination does not reveal drafts or skip their cursor', async () => {
  mockGet.mockResolvedValue({ docs: [row('2026-10', false), row('2026-09', true)] });
  const first = await getPortalOverview({ ...input, limit: 1 }, auth());
  expect(first).toMatchObject({ payslips: [], hasMore: true, lastDocId: '2026-10' });
  mockGet.mockResolvedValue({ docs: [row('2026-09', true)] });
  const second = await getPortalOverview({ ...input, limit: 1, lastDocId: first.lastDocId! }, auth());
  expect(second.payslips[0].yearMonth).toBe('2026-09');
  expect(second.hasMore).toBe(false);
  expect(mockStartAfter).toHaveBeenCalledWith(expect.objectContaining({ id: '2026-10' }));
});

test('旧計算の拠出金0円を支援金0円として表示しない', async () => {
  const insurance = docs.get(`${root}/monthlyInsurance/2026-10`)!;
  delete insurance.childSupportPayment;
  const result = await getPortalPayslip(detail, auth());
  expect(result.insurance?.childSupportPayment).toBeNull();
  expect(result.insurance?.totalEmployee).toBe(46500);
  expect(result.insurance).not.toHaveProperty('childSupportContribution');
});

test('未公開給与は承認済みでも本人に公開しない', async () => {
  docs.get(`${root}/salaries/2026-10`)!.isPublished = false;
  await expect(getPortalPayslip(detail, auth())).rejects.toMatchObject({ code: 'not-found' });
});
test.each(['missing', 'draft'])('detail hides %s salaries', async state => {
  if (state === 'missing') docs.delete(`${root}/salaries/2026-10`);
  else docs.get(`${root}/salaries/2026-10`)!.isConfirmed = false;
  await expect(getPortalPayslip(detail, auth())).rejects.toMatchObject({ code: 'not-found' });
  expect(mockDocGet).not.toHaveBeenCalledWith(`${root}/monthlyInsurance/2026-10`);
});
test.each(['missing', 'draft'])('missing or unapproved insurance %s remains unknown', async state => {
  if (state === 'missing') docs.delete(`${root}/monthlyInsurance/2026-10`);
  else docs.get(`${root}/monthlyInsurance/2026-10`)!.isConfirmed = false;
  expect((await getPortalPayslip(detail, auth())).insurance).toBeNull();
});
test('does not fabricate missing amounts and filters invalid allowance values', async () => {
  docs.set(`${root}/salaries/2026-10`, { isConfirmed: true, isPublished: true, baseSalary: NaN, fixedAllowances: { housing: 20000, invalid: 'secret', bad: Infinity } });
  docs.set(`${root}/monthlyInsurance/2026-10`, { isConfirmed: true, yearMonth: '2026-10' });
  const result = await getPortalPayslip(detail, auth());
  expect(result).toMatchObject({ baseSalary: null, totalSalary: null, fixedAllowances: { housing: 20000 }, variableAllowances: {}, insurance: { health: null, longTermCare: null, totalEmployee: null } });
});
test('missing pagination cursor returns an error, rather than restarting and duplicating rows', async () => {
  await expect(getPortalOverview({ ...input, lastDocId: 'missing' }, auth())).rejects.toMatchObject({ code: 'not-found' });
  expect(mockGet).not.toHaveBeenCalled();
});
test('strict schemas reject employee overrides, invalid months, unbounded pages and paths', () => {
  expect(portalOverviewSchema.parse({ companyId: input.companyId }).limit).toBe(12);
  for (const bad of [{ ...input, employeeId: 'other' }, { ...input, limit: 51 }, { ...input, lastDocId: 'a/b' }]) {
    expect(portalOverviewSchema.safeParse(bad).success).toBe(false);
  }
  for (const bad of [{ ...detail, employeeId: 'other' }, { ...detail, yearMonth: '2026-13' }, { ...detail, companyId: 'a/b' }]) {
    expect(portalPayslipGetSchema.safeParse(bad).success).toBe(false);
  }
});
