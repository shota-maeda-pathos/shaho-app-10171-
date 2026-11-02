import { makeAuth } from '../../__tests__/helpers';
import { isValidInsurerNumber, isValidMyNumber, isValidCorporateNumber } from '../../utils/check-digit';
const mockData = new Map<string, any>();
const mockLinked = new Map<string, string>();
jest.mock('../../config', () => {
  const ref = (path: string) => ({ path, get: async () => ({ exists: mockData.has(path), data: () => mockData.get(path) }) });
  const snapshot = (r: any) => ({ exists: mockData.has(r.path), data: () => mockData.get(r.path) });
  return { db: {
    doc: ref,
    collection: (path: string) => {
      let uid = '';
      const q: any = { where: (_f: string, _op: string, v: string) => { uid = v; return q; },
        get: async () => ({ docs: mockLinked.has(uid) ? [{ data: () => ({ deletedAt: null }) }] : [] }),
        doc: () => ref(`${path}/audit-${mockData.size}`) };
      return q;
    },
    getAll: async (...refs: any[]) => refs.map(snapshot),
    batch: () => {
      const writes: [string, any, boolean][] = [];
      return { set: (r: any, d: any, o?: any) => writes.push([r.path, d, !!o?.merge]),
        commit: async () => { for (const [p, d, m] of writes) mockData.set(p, m ? { ...(mockData.get(p) ?? {}), ...d } : d); } };
    },
  } };
});
jest.mock('firebase-admin/auth', () => ({ getAuth: () => ({
  getUsers: async (ids: { email: string }[]) => ({ users: ids.map(i => ({ email: i.email, uid: `uid-${i.email.split('@')[0]}` })) }),
}) }));
let mockNoUnionRate = false;
jest.mock('../../utils/insurance-rate', () => {
  const actual = jest.requireActual('../../utils/insurance-rate');
  const rate = (insuranceType: string, employeeRate: number, employerRate: number) => ({ insuranceType, appliedFrom: '2024-04', employeeRate, employerRate, totalRate: employeeRate + employerRate });
  return { ...actual, findAllRates: async (_c: string, _ym: string, _p: string, insurerId: string) => ({
    health: mockNoUnionRate && insurerId === '06139901' ? null : rate('health', 49.55, 49.55), pension: rate('pension', 91.5, 91.5),
    childSupport: rate('childSupport', 0, 3.6), longTermCare: rate('longTermCare', 7.95, 7.95), childSupportPayment: null,
  }) };
});
jest.mock('../../utils/kms', () => ({ encryptMyNumber: async (_c: string, id: string, plain: string) => `enc(${id}:${plain})` }));
import { seedDemoData } from './service';
import { ageOn, buildDemoEmployees, DEMO_ACCOUNTS, DEMO_COMPANY, DEMO_DEPARTMENTS, DEMO_OFFICES, DEMO_RESERVED_NUMBER } from './data';

const base = 'companies/company-001';
const auth = () => makeAuth({ uid: 'uid-test1', roles: ['admin'] });
const seedUsers = () => { for (let n = 1; n <= 9; n++) mockData.set(`${base}/users/uid-test${n}`, { roles: ['admin'], employeeId: `sample-tigers-0${n}` }); };
beforeEach(() => { mockNoUnionRate = false; mockData.clear(); mockLinked.clear(); seedUsers(); mockData.set(base, { name: '株式会社パトスロゴス', version: 3, corporateNumber: '1234567890123' }); });

describe('評価用のテストデータの中身', () => {
  const list = buildDemoEmployees();
  it('3か所で300人。番号は重ならず、12番は入社の手続き用に空ける', () => {
    expect(list).toHaveLength(300);
    expect(new Set(list.map(e => e.employeeNumber)).size).toBe(300);
    expect(new Set(list.map(e => e.email)).size).toBe(300);
    expect(list.some(e => e.n === DEMO_RESERVED_NUMBER)).toBe(false);
    const count = (id: string) => list.filter(e => e.officeId === id).length;
    expect([count('office-hq'), count('office-osaka'), count('office-union')]).toEqual([170, 80, 50]);
    expect(list.every(e => e.email === `test${e.n}@example.com` && e.employeeNumber === String(e.n).padStart(4, '0'))).toBe(true);
  });
  it('test1〜9 は阪神の名前のまま、決めた事業所に入る', () => {
    for (const [n, a] of Object.entries(DEMO_ACCOUNTS)) {
      const e = list.find(x => x.n === Number(n))!;
      expect(e.officeId).toBe(a.officeId);
    }
    expect(list.find(e => e.n === 1)).toMatchObject({ lastName: '森下', firstName: '翔太', birthDate: '2000-08-14' });
    expect(list.find(e => e.n === 10)).toMatchObject({ gender: 'female', officeId: 'office-hq' });
    expect(list.find(e => e.n === 11)).toMatchObject({ officeId: 'office-osaka' });
  });
  it('番号・住所・カナがすべて埋まり、番号の形と検査用数字が正しい', () => {
    for (const e of list) {
      expect(isValidMyNumber(e.myNumber)).toBe(true);
      expect(e.basicPensionNumber).toMatch(/^\d{4}-\d{6}$/);
      expect(e.postalCode).toMatch(/^\d{3}-\d{4}$/);
      expect(e.phone).toMatch(/^[0-9-]{10,13}$/);
      expect(e.lastNameKana).toMatch(/^[ァ-ヶー]+$/);
      expect(e.firstNameKana).toMatch(/^[ァ-ヶー]+$/);
      expect(e.addressLine).toContain('（テスト）');
      expect(e.hireDate < '2026-11-01' && e.hireDate > e.birthDate).toBe(true);
    }
    expect(new Set(list.map(e => e.myNumber)).size).toBe(300);
    for (const o of DEMO_OFFICES) {
      expect(isValidInsurerNumber(o.insurerId)).toBe(true);
      expect(o.officeCode).toMatch(/^\d{5}$/);
      expect(o.officeNumber).toMatch(/^\d{2}-[ァ-ヶー]{1,4}$/);
      // 整理番号は事業所ごとに 1 からの連番
      const numbers = list.filter(e => e.officeId === o.id).map(e => Number(e.insuredPersonNumber));
      expect(numbers).toEqual(numbers.map((_, i) => i + 1));
    }
    expect(isValidCorporateNumber(DEMO_COMPANY.corporateNumber)).toBe(true);
  });
  it('全員が自分の事業所の部署に入り、どの部署にも人がいる', () => {
    for (const e of list) expect(DEMO_DEPARTMENTS.find(d => d.id === e.departmentId)?.officeId).toBe(e.officeId);
    for (const d of DEMO_DEPARTMENTS) expect(list.filter(e => e.departmentId === d.id).length).toBeGreaterThan(5);
  });
  it('年齢・性別・働き方・扶養が散らばる', () => {
    expect(list.filter(e => e.gender === 'female').length).toBeGreaterThan(90);
    expect(list.some(e => ageOn(e.birthDate) >= 70)).toBe(true);
    expect(list.some(e => e.longTermCare)).toBe(true);
    expect(list.some(e => e.insuredCategory === 'partTimer')).toBe(true);
    expect(list.some(e => e.insuredCategory === 'shortTime')).toBe(true);
    expect(list.some(e => e.contract.type === 'fixed')).toBe(true);
    expect(list.filter(e => e.dependents.some(d => d.relationship === 'spouse')).length).toBeGreaterThan(20);
    expect(list.some(e => e.dependents.some(d => d.relationship === 'child'))).toBe(true);
    expect(DEMO_OFFICES.every(o => list.some(e => e.officeId === o.id && e.gender === 'female'))).toBe(true);
  });
});

describe('作成', () => {
  it('事業所・従業員・暗号化した個人番号を作り、test1〜9 をつなぎ直す', async () => {
    const result = await seedDemoData(auth());
    expect(result).toMatchObject({ created: 300, alreadyExists: false });
    expect(mockData.get(`${base}/offices/office-osaka`)).toMatchObject({ insurerId: '01270016', officeCode: '30412', insuredNumberMode: 'auto' });
    expect(mockData.get(`${base}/counters/insured-office-union`)).toMatchObject({ last: 50 });
    expect(mockData.get(`${base}/employees/demo-0001`)).toMatchObject({ lastName: '森下', userId: 'uid-test1', officeId: 'office-hq', insuredPersonNumber: '1' });
    expect(mockData.get(`${base}/employees/demo-0013`).userId).toBeNull();
    expect(mockData.get(`${base}/departments/dept-hq-hr`)).toMatchObject({ name: '人事部', officeId: 'office-hq', isActive: true });
    expect(mockData.get(`${base}/employees/demo-0002`).departmentId).toBe('dept-hq-hr');
    expect(mockData.get(`${base}/employees/demo-0002/secrets/main`).myNumberCipher).toMatch(/^enc\(demo-0002:\d{12}\)$/);
    expect(mockData.get(`${base}/users/uid-test3`)).toMatchObject({ employeeId: 'demo-0003', roles: ['operator'], officeIds: ['office-osaka', 'office-union'] });
    expect(mockData.get(`${base}/users/uid-test6`).roles).toEqual(['approver']);
    expect(mockData.get(base)).toMatchObject({ name: '株式会社パトスロゴス', corporateNumber: DEMO_COMPANY.corporateNumber, version: 4 });
    // 履歴：本社（当月控除）は10月分まで、大阪（翌月控除）は9月分まで保険料が承認済み。今月の給与は取り込んだだけ
    expect(mockData.get(`${base}/employees/demo-0001/monthlyInsurance/2026-10`)).toMatchObject({ isConfirmed: true, healthStandardRemuneration: 300_000 });
    expect(mockData.get(`${base}/employees/demo-0001/salaries/2026-10`)).toMatchObject({ isConfirmed: true, isPublished: true, deductedPremiumMonth: '2026-10' });
    expect(mockData.get(`${base}/employees/demo-0001/collectionReceipts/2026-10`)).toMatchObject({ collectedAmount: mockData.get(`${base}/employees/demo-0001/monthlyInsurance/2026-10`).totalEmployeeAmount });
    expect(mockData.get(`${base}/employees/demo-0001/salaries/2026-11`)).toMatchObject({ isConfirmed: false, isPublished: false });
    expect(mockData.has(`${base}/employees/demo-0003/monthlyInsurance/2026-10`)).toBe(false);
    expect(mockData.get(`${base}/employees/demo-0003/salaries/2026-10`).deductedPremiumMonth).toBe('2026-09');
    expect(mockData.get(`${base}/employees/demo-0003/monthlyInsurance/2025-12`).isConfirmed).toBe(true);
    expect(mockData.get(`${base}/employees/demo-0001/grades/2025-09`)).toMatchObject({ determinationType: 'regular', isConfirmed: true });
    expect(mockData.get(`${base}/employees/demo-0001/bonusInsurance/2026-07`)).toMatchObject({ isConfirmed: true, bonusTarget: 'charged' });
    expect(mockData.get(`${base}/employees/demo-0009/bonuses/2026-06`)).toMatchObject({ isConfirmed: true });
    expect(mockData.has(`${base}/sampleSets/demo-v1`)).toBe(true);
    // 2回目は何もしない
    const size = mockData.size;
    expect((await seedDemoData(auth())).alreadyExists).toBe(true);
    expect(mockData.size).toBe(size);
  });
  it('古いデータが残っていれば上書きせずに止める', async () => {
    mockData.set(`${base}/offices/office-hq`, { name: '本社' });
    await expect(seedDemoData(auth())).rejects.toThrow('古いテストデータを消してから');
    mockData.delete(`${base}/offices/office-hq`);
    mockLinked.set('uid-test2', 'sample-tigers-02');
    await expect(seedDemoData(auth())).rejects.toThrow('test2 がまだ古い従業員につながっています');
    expect(mockData.has(`${base}/sampleSets/demo-v1`)).toBe(false);
  });
  it('料率がない月があれば何も書かずに止める', async () => {
    mockNoUnionRate = true;
    const size = mockData.size;
    await expect(seedDemoData(auth())).rejects.toThrow('健康保険料率がありません');
    expect(mockData.size).toBe(size);
  });
  it('管理者でなければ作れない', async () => {
    await expect(seedDemoData(makeAuth({ roles: ['operator'] }))).rejects.toThrow();
  });
});
