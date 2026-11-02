import { Timestamp } from 'firebase-admin/firestore';
import { makeAuth, makeEmployeeDoc, MockFirestore } from '../../__tests__/helpers';

let mockDb: MockFirestore;

jest.mock('../../config', () => ({
  get db() {
    return mockDb;
  },
}));

import { getEmployeePortalStatus, inviteEmployeeToPortal } from './service';

const base = 'companies/company-001';
const days = (n: number) => Timestamp.fromMillis(Date.now() + n * 24 * 60 * 60 * 1000);
const input = { companyId: 'company-001', employeeId: 'emp-001', email: 'taro@example.com', replace: false };
const writes = () => mockDb.lastTransaction!.ops;

describe('employeePortalInvite', () => {
  beforeEach(() => {
    mockDb = new MockFirestore();
    mockDb.setDoc(`${base}/employees/emp-001`, makeEmployeeDoc({ officeId: 'office-001', email: 'taro@example.com' }) as any);
  });

  it('従業員のロール・その人の事業所・従業員とのつながりで招待を作る', async () => {
    const result = await inviteEmployeeToPortal(input, makeAuth({ roles: ['operator'] }));
    expect(result).toMatchObject({ success: true, email: 'taro@example.com', reused: false });
    const invite = writes().find(op => op.ref.includes('/invitations/'));
    expect(invite?.data).toMatchObject({ roles: ['employee'], officeIds: ['office-001'], employeeId: 'emp-001', status: 'pending' });
    expect(writes().some(op => op.ref.includes('/auditLogs/'))).toBe(true);
  });

  it('受け取られていない有効な招待があれば、作らずにそれを返す', async () => {
    mockDb.setDoc(`${base}/invitations/inv-1`, { email: 'taro@example.com', employeeId: 'emp-001', status: 'pending', expiresAt: days(3) });
    const result = await inviteEmployeeToPortal(input, makeAuth());
    expect(result).toMatchObject({ id: 'inv-1', reused: true });
    expect(writes()).toHaveLength(0);
  });

  it('replace のときは、有効な招待を無効にして別のメールで作り直す', async () => {
    mockDb.setDoc(`${base}/invitations/inv-1`, { email: 'typo@example.com', employeeId: 'emp-001', status: 'pending', expiresAt: days(3) });
    const result = await inviteEmployeeToPortal({ ...input, replace: true }, makeAuth());
    expect(result).toMatchObject({ email: 'taro@example.com', reused: false });
    expect(writes()).toContainEqual({ type: 'update', ref: `${base}/invitations/inv-1`, data: expect.objectContaining({ status: 'expired' }) });
  });

  it('replace で同じメールのまま作り直してもよい（自分あての招待はメールの重なりに数えない）', async () => {
    mockDb.setDoc(`${base}/invitations/inv-1`, { email: 'taro@example.com', employeeId: 'emp-001', status: 'pending', expiresAt: days(3) });
    const result = await inviteEmployeeToPortal({ ...input, replace: true }, makeAuth());
    expect(result.reused).toBe(false);
  });

  it('期限切れの招待は expired にして作り直す', async () => {
    mockDb.setDoc(`${base}/invitations/inv-old`, { email: 'taro@example.com', employeeId: 'emp-001', status: 'pending', expiresAt: days(-1) });
    const result = await inviteEmployeeToPortal(input, makeAuth());
    expect(result.reused).toBe(false);
    expect(writes()).toContainEqual({ type: 'update', ref: `${base}/invitations/inv-old`, data: expect.objectContaining({ status: 'expired' }) });
  });

  it('すでにアカウントにつながっている・退職した・担当外の従業員は招待できない', async () => {
    mockDb.setDoc(`${base}/employees/emp-001`, makeEmployeeDoc({ officeId: 'office-001', userId: 'uid-1' }) as any);
    await expect(inviteEmployeeToPortal(input, makeAuth())).rejects.toThrow('すでに本人ポータル');
    mockDb.setDoc(`${base}/employees/emp-001`, makeEmployeeDoc({ officeId: 'office-001', isActive: false }) as any);
    await expect(inviteEmployeeToPortal(input, makeAuth())).rejects.toThrow('退職');
    mockDb.setDoc(`${base}/employees/emp-001`, makeEmployeeDoc({ officeId: 'office-002' }) as any);
    await expect(inviteEmployeeToPortal(input, makeAuth({ roles: ['operator'] }))).rejects.toThrow('担当事業所外');
  });

  it('ほかのアカウントや別の有効な招待が使っているメールでは招待できない', async () => {
    mockDb.setDoc(`${base}/users/uid-9`, { email: 'taro@example.com' });
    await expect(inviteEmployeeToPortal(input, makeAuth())).rejects.toThrow('別のアカウント');
    mockDb = new MockFirestore();
    mockDb.setDoc(`${base}/employees/emp-001`, makeEmployeeDoc({ officeId: 'office-001' }) as any);
    mockDb.setDoc(`${base}/invitations/inv-x`, { email: 'taro@example.com', employeeId: null, status: 'pending', expiresAt: days(3) });
    await expect(inviteEmployeeToPortal(input, makeAuth())).rejects.toThrow('別の招待');
  });
});

describe('employeePortalStatus', () => {
  beforeEach(() => {
    mockDb = new MockFirestore();
  });

  it('つながっていればアカウントのメール、招待中なら招待、どちらもなければ台帳のメールを返す', async () => {
    const status = { companyId: 'company-001', employeeId: 'emp-001' };
    mockDb.setDoc(`${base}/employees/emp-001`, makeEmployeeDoc({ officeId: 'office-001', email: 'ledger@example.com' }) as any);
    expect(await getEmployeePortalStatus(status, makeAuth())).toEqual({ state: 'none', email: 'ledger@example.com', canInvite: true });

    mockDb.setDoc(`${base}/invitations/inv-old`, { email: 'a@example.com', employeeId: 'emp-001', status: 'pending', expiresAt: days(-1) });
    expect((await getEmployeePortalStatus(status, makeAuth())).state).toBe('none');
    mockDb.setDoc(`${base}/invitations/inv-1`, { email: 'a@example.com', employeeId: 'emp-001', status: 'pending', expiresAt: days(3) });
    expect(await getEmployeePortalStatus(status, makeAuth())).toMatchObject({ state: 'invited', invitationId: 'inv-1', email: 'a@example.com' });

    mockDb.setDoc(`${base}/employees/emp-001`, makeEmployeeDoc({ officeId: 'office-001', userId: 'uid-1' }) as any);
    mockDb.setDoc(`${base}/users/uid-1`, { email: 'taro@example.com' });
    expect(await getEmployeePortalStatus(status, makeAuth())).toEqual({ state: 'active', email: 'taro@example.com', access: 'full', readonlyFrom: null, loginStopsFrom: null });
  });

  it('退職で決まった日に応じて、閲覧のみ・ログイン停止・予定を分けて返す', async () => {
    const status = { companyId: 'company-001', employeeId: 'emp-001' };
    mockDb.setDoc(`${base}/employees/emp-001`, makeEmployeeDoc({ officeId: 'office-001', userId: 'uid-1' }) as any);
    mockDb.setDoc(`${base}/users/uid-1`, { email: 'taro@example.com', suspendFrom: '2099-01-01', loginDisabledFrom: '2099-04-01' });
    expect(await getEmployeePortalStatus(status, makeAuth())).toMatchObject({ access: 'full', readonlyFrom: '2099-01-01', loginStopsFrom: '2099-04-01' });
    mockDb.setDoc(`${base}/users/uid-1`, { email: 'taro@example.com', suspendFrom: '2020-01-01', loginDisabledFrom: '2099-04-01' });
    expect(await getEmployeePortalStatus(status, makeAuth())).toMatchObject({ access: 'readonly' });
    mockDb.setDoc(`${base}/users/uid-1`, { email: 'taro@example.com', suspendFrom: '2020-01-01', loginDisabledFrom: '2020-04-01' });
    expect(await getEmployeePortalStatus(status, makeAuth())).toMatchObject({ access: 'disabled' });
    mockDb.setDoc(`${base}/users/uid-1`, { email: 'taro@example.com', isLoginDisabled: true });
    expect(await getEmployeePortalStatus(status, makeAuth())).toMatchObject({ access: 'disabled' });
  });
});
