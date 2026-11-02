import { makeAuth } from '../../__tests__/helpers';
const mockData = new Map<string, any>();
let mockRatesExist = false;
jest.mock('../../config', () => {
  const ref = (path: string) => ({ path });
  const snapshot = (r: any) => ({ exists: mockData.has(r.path), data: () => mockData.get(r.path) });
  return { db: {
    doc: ref,
    collection: (path: string) => { const q: any = { path, query: true, where: () => q, limit: () => q, doc: (id = 'audit') => ref(`${path}/${id}`) }; return q; },
    runTransaction: async (fn: any) => {
      const writes: any[] = [];
      const tx = {
        get: async (r: any) => { if (writes.length) throw new Error('read after write'); return r.query ? { empty: !mockRatesExist } : snapshot(r); },
        getAll: async (...refs: any[]) => { if (writes.length) throw new Error('read after write'); return refs.map(snapshot); },
        create: (r: any, d: any) => { if (mockData.has(r.path)) throw new Error('exists'); writes.push([r.path, d]); },
      };
      const result = await fn(tx);
      for (const [path, data] of writes) mockData.set(path, data);
      return result;
    },
  } };
});
import { seedTigersSamples } from './service';
import { samplePlayers } from './data';
const auth = () => makeAuth({ uid: 'MJNjXeCfoYaohOgT5G4EZQf8URE3' });
const base = 'companies/company-001';
beforeEach(() => { mockData.clear(); mockRatesExist = false; });
test('creates nine employees, actual birthdays, matching emails, and no fictional rates', async () => {
  expect(await seedTigersSamples(auth())).toEqual({ created: 9, total: 9, alreadyExists: false });
  for (const p of samplePlayers) {
    const id = `sample-tigers-${String(p.n).padStart(2, '0')}`;
    const employee = mockData.get(`${base}/employees/${id}`);
    expect(employee.birthDate.toDate().toISOString().slice(0, 10)).toBe(p.birth);
    expect(employee.email).toBe(`test${p.n}@example.com`);
    expect(employee.userId).toBeNull();
    expect(mockData.has(`${base}/employees/${id}/grades/2026-04`)).toBe(true);
    expect(mockData.has(`${base}/employees/${id}/salaries/2026-10`)).toBe(true);
    expect(mockData.has(`${base}/employeeNumbers/${employee.employeeNumber}`)).toBe(true);
  }
  expect(samplePlayers.some(p => p.last === '藤村')).toBe(false);
  // 架空の料率は作らない（兵庫の協会けんぽの料率より優先されてしまうため）。事業所に架空の保険者も付けない
  expect([...mockData.keys()].some(k => k.includes('/insuranceRates/'))).toBe(false);
  expect(mockData.get(`${base}/offices/sample-tigers-office`).insurerId).toBeUndefined();
});
test('repeated invocation creates no duplicate or overwrite', async () => {
  await seedTigersSamples(auth());
  const count = mockData.size;
  expect((await seedTigersSamples(auth())).alreadyExists).toBe(true);
  expect(mockData.size).toBe(count);
});
test('preserves existing company name', async () => {
  mockData.set(base, { name: '既存会社' }); mockRatesExist = true;
  await seedTigersSamples(auth());
  expect(mockData.get(base)).toEqual({ name: '既存会社' });
  expect(mockData.has(`${base}/insuranceRates/sample-health`)).toBe(false);
});
test('employee number collision aborts all writes', async () => {
  mockData.set(`${base}/employeeNumbers/TEST-001`, { employeeId: 'existing' });
  await expect(seedTigersSamples(auth())).rejects.toThrow('重複');
  expect(mockData.size).toBe(1);
});
test.each([
  { roles: ['operator'] }, { uid: 'other-admin' }, { companyId: 'other' }, { isSuspended: true }, { isLoginDisabled: true },
])('rejects unauthorized context %j', async (override) => {
  await expect(seedTigersSamples({ ...auth(), ...override } as any)).rejects.toThrow();
  expect(mockData.size).toBe(0);
});
