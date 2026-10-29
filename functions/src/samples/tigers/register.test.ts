import { makeAuth, makeEmployeeDoc } from '../../__tests__/helpers';
const mockDocs = new Map<string, any>();
const mockLookup = jest.fn();
const mockCreate = jest.fn();
const mockGetByEmail = jest.fn();
const mockSeed = jest.fn();
jest.mock('firebase-admin/auth', () => ({ getAuth: () => ({ getUsers: mockLookup, createUser: mockCreate, getUserByEmail: mockGetByEmail }) }));
jest.mock('./service', () => ({ seedTigersSamples: (...args: any[]) => mockSeed(...args) }));
jest.mock('../../config', () => {
  const snapshot = (path: string) => ({ exists: mockDocs.has(path), id: path.split('/').pop(), data: () => mockDocs.get(path) });
  const ref = (path: string) => ({ path, get: async () => snapshot(path) });
  return { db: {
    doc: ref,
    collection: (path: string) => ({ doc: () => ref(`${path}/audit`), where: (field: string, op: string, value: unknown) => ({ path, field, value, query: true }) }),
    runTransaction: async (fn: any) => {
      const writes: (() => void)[] = [];
      const tx = {
        get: async (r: any) => {
          if (writes.length) throw new Error('read after write');
          return r.query ? { docs: [...mockDocs.entries()].filter(([path, data]) => path.startsWith(r.path + '/') && !path.slice(r.path.length + 1).includes('/') && data[r.field] === r.value).map(([path]) => snapshot(path)) } : snapshot(r.path);
        },
        getAll: async (...refs: any[]) => { if (writes.length) throw new Error('read after write'); return refs.map(r => snapshot(r.path)); },
        set: (r: any, d: any) => writes.push(() => mockDocs.set(r.path, { ...mockDocs.get(r.path), ...d })),
        update: (r: any, d: any) => writes.push(() => mockDocs.set(r.path, { ...mockDocs.get(r.path), ...d })),
        create: (r: any, d: any) => writes.push(() => { if (mockDocs.has(r.path)) throw new Error('exists'); mockDocs.set(r.path, d); }),
      };
      const result = await fn(tx);
      writes.forEach(write => write());
      return result;
    },
  } };
});
import { registerTigers, tigersRoles } from './register';
const uid = 'MJNjXeCfoYaohOgT5G4EZQf8URE3';
const base = 'companies/company-001';
const actor = () => makeAuth({ uid });
const account = (n: number) => ({ uid: n === 1 ? uid : `uid-${n}`, email: `test${n}@example.com` });
beforeEach(() => {
  jest.clearAllMocks(); mockDocs.clear(); mockSeed.mockResolvedValue({ alreadyExists: true });
  mockLookup.mockResolvedValue({ users: Array.from({ length: 9 }, (_, i) => account(i + 1)) });
  mockDocs.set(`${base}/users/${uid}`, { roles: ['admin'], isSuspended: false, employeeId: null, unrelated: 'preserve' });
  for (let n = 1; n <= 9; n++) mockDocs.set(`${base}/employees/sample-tigers-${String(n).padStart(2, '0')}`, { ...makeEmployeeDoc(), sampleSetId: 'tigers-v1', isSample: true });
  mockDocs.set(`${base}/offices/sample-tigers-office`, { name: 'サンプル甲子園事業所', sampleSetId: 'tigers-v1' });
  mockDocs.set(`${base}/departments/sample-tigers-team`, { sampleSetId: 'tigers-v1' });
  mockDocs.set(base, { name: '利用者の会社名' });
  mockDocs.set(`users/${uid}`, { role: 'other-app-role' });
});
test('registers nine existing accounts, exact roles and reciprocal employee links without changing Auth', async () => {
  const result = await registerTigers(actor());
  expect(result.users).toHaveLength(9); expect(result.credentials).toEqual([]);
  expect(mockCreate).not.toHaveBeenCalled();
  for (let n = 1; n <= 9; n++) {
    const employeeId = `sample-tigers-${String(n).padStart(2, '0')}`;
    expect(mockDocs.get(`${base}/users/${account(n).uid}`)).toMatchObject({ employeeId, roles: [tigersRoles[n]], officeIds: ['sample-tigers-office'] });
    expect(mockDocs.get(`${base}/employees/${employeeId}`)).toMatchObject({ userId: account(n).uid, isSample: false, version: 2 });
  }
  expect(mockDocs.get(`${base}/users/${uid}`).unrelated).toBe('preserve');
  expect(mockDocs.get(`users/${uid}`)).toEqual({ role: 'other-app-role' });
  expect(mockDocs.get(base).name).toBe('利用者の会社名');
  expect(mockDocs.get(`${base}/offices/sample-tigers-office`).name).toBe('甲子園事業所');
});
test('repeated registration preserves subsequent user and employee edits', async () => {
  await registerTigers(actor());
  mockDocs.get(`${base}/users/uid-2`).roles = ['viewer'];
  mockDocs.get(`${base}/employees/sample-tigers-02`).version = 5;
  jest.clearAllMocks();
  expect((await registerTigers(actor())).alreadyRegistered).toBe(true);
  expect(mockLookup).not.toHaveBeenCalled(); expect(mockSeed).not.toHaveBeenCalled();
  expect(mockDocs.get(`${base}/users/uid-2`).roles).toEqual(['viewer']);
  expect(mockDocs.get(`${base}/employees/sample-tigers-02`).version).toBe(5);
});
test('creates only a missing Auth account, returns its password once, never persists credentials', async () => {
  mockLookup.mockResolvedValue({ users: Array.from({ length: 8 }, (_, i) => account(i + 1)) });
  mockCreate.mockResolvedValue(account(9));
  const result = await registerTigers(actor());
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ email: 'test9@example.com', password: expect.any(String) }));
  const password = result.credentials[0].password;
  expect(password.length).toBeGreaterThanOrEqual(24);
  expect(JSON.stringify([...mockDocs.values()])).not.toContain(password);
  expect((await registerTigers(actor())).credentials).toEqual([]);
});
test('never resets credentials when another request has already created an account', async () => {
  mockLookup.mockResolvedValue({ users: Array.from({ length: 8 }, (_, i) => account(i + 1)) });
  mockCreate.mockRejectedValue({ code: 'auth/email-already-exists' }); mockGetByEmail.mockResolvedValue(account(9));
  expect((await registerTigers(actor())).credentials).toEqual([]);
  expect(mockGetByEmail).toHaveBeenCalledWith('test9@example.com');
});
test.each([
  { uid: 'another-admin' }, { companyId: 'another-company' }, { roles: ['employee'] as const }, { isLoginDisabled: true }, { isSuspended: true },
])('denies unauthorized registration %j', async override => {
  await expect(registerTigers(makeAuth({ uid, ...override, roles: override.roles ? [...override.roles] : ['admin'] }))).rejects.toMatchObject({ code: 'permission-denied' });
  expect(mockSeed).not.toHaveBeenCalled(); expect(mockLookup).not.toHaveBeenCalled();
});
test('requires the designated administrator Auth account to match test1', async () => {
  mockLookup.mockResolvedValue({ users: [{ uid: 'another-user', email: 'test1@example.com' }] });
  await expect(registerTigers(actor())).rejects.toMatchObject({ code: 'failed-precondition' });
  expect(mockCreate).not.toHaveBeenCalled();
});
test.each(['employee-link', 'profile-link', 'deleted', 'not-seed'])('preflight rejects conflicting existing state %s', async state => {
  const employee = mockDocs.get(`${base}/employees/sample-tigers-01`);
  if (state === 'employee-link') employee.userId = 'another-user';
  if (state === 'profile-link') mockDocs.get(`${base}/users/${uid}`).employeeId = 'another-employee';
  if (state === 'deleted') employee.deletedAt = 'deleted';
  if (state === 'not-seed') employee.sampleSetId = 'other';
  await expect(registerTigers(actor())).rejects.toMatchObject({ code: 'failed-precondition' });
  expect(mockCreate).not.toHaveBeenCalled();
  expect(mockDocs.has(`${base}/registrations/tigers-v1`)).toBe(false);
});
test.each(['employee', 'profile'])('duplicate %s links abort the entire Firestore transaction', async type => {
  if (type === 'employee') mockDocs.set(`${base}/employees/unrelated`, { userId: 'uid-9' });
  else mockDocs.set(`${base}/users/unrelated`, { employeeId: 'sample-tigers-09' });
  await expect(registerTigers(actor())).rejects.toMatchObject({ code: 'failed-precondition' });
  expect(mockDocs.get(`${base}/employees/sample-tigers-01`).userId).toBeNull();
  expect(mockDocs.has(`${base}/registrations/tigers-v1`)).toBe(false);
});
test('preserves suspension and login-disabled flags', async () => {
  mockDocs.set(`${base}/users/uid-2`, { isSuspended: true, isLoginDisabled: true });
  await registerTigers(actor());
  expect(mockDocs.get(`${base}/users/uid-2`)).toMatchObject({ isSuspended: true, isLoginDisabled: true });
});
