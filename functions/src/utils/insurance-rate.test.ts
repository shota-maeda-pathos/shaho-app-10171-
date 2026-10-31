import { MockFirestore } from '../__tests__/helpers';

let mockDb: MockFirestore;
jest.mock('../config', () => ({
  get db() {
    return mockDb;
  },
}));

import { findApplicableRate, rateMatchScore, rateValuesChanged } from './insurance-rate';

describe('料率の変化（rateValuesChanged）', () => {
  const fp = (cs: string) => `health:2026-03:49.25/49.25/98.5|pension:2020-09:91.5/91.5/183|longTermCare:2026-03:7.95/7.95/15.9|childSupport:2026-04:0/3.6/3.6|childSupportPayment:${cs}`;
  it('支援金がマスタになかった時の計算は、同じ値の支援金を取り込んでも変わらないとみなす', () => {
    expect(rateValuesChanged(fp('-'), fp('2026-04:1.15/1.15/2.3'), '2026-10')).toBe(false);
  });
  it('値が違えば変わったとみなす', () => {
    expect(rateValuesChanged(fp('-'), fp('2026-04:1.2/1.2/2.4'), '2026-10')).toBe(true);
    expect(rateValuesChanged(fp('-'), fp('-').replace('49.25/49.25/98.5', '49.55/49.55/99.1'), '2026-10')).toBe(true);
  });
  it('開始月だけ違う（同じ値の料率が足された）なら変わらない', () => {
    expect(rateValuesChanged(fp('-'), fp('-').replace('health:2026-03', 'health:2027-03'), '2027-03')).toBe(false);
  });
});

const rates = 'companies/c1/insuranceRates';
const put = (id: string, data: Record<string, unknown>) => mockDb.setDoc(`${rates}/${id}`, { appliedUntil: null, employeeRate: 1, employerRate: 1, totalRate: 2, ...data });

beforeEach(() => {
  mockDb = new MockFirestore();
});

describe('料率の当てはめ', () => {
  it('健保は事業所の都道府県の料率だけを使い、別の都道府県の料率は使わない', async () => {
    put('h13', { insuranceType: 'health', prefectureCode: '13', insurerId: 'kyokai', appliedFrom: '2026-03' });
    put('h27', { insuranceType: 'health', prefectureCode: '27', insurerId: 'kyokai', appliedFrom: '2026-03' });
    expect((await findApplicableRate({ companyId: 'c1', insuranceType: 'health', yearMonth: '2026-10', prefectureCode: '27', insurerId: '27130045' }))?.prefectureCode).toBe('27');
    expect(await findApplicableRate({ companyId: 'c1', insuranceType: 'health', yearMonth: '2026-10', prefectureCode: '01', insurerId: 'kyokai' })).toBeNull();
  });

  it('適用期間内で最新の料率を使う', async () => {
    put('old', { insuranceType: 'health', prefectureCode: '13', appliedFrom: '2025-03', appliedUntil: '2026-02', totalRate: 1 });
    put('new', { insuranceType: 'health', prefectureCode: '13', appliedFrom: '2026-03', totalRate: 9 });
    expect((await findApplicableRate({ companyId: 'c1', insuranceType: 'health', yearMonth: '2026-02', prefectureCode: '13' }))?.totalRate).toBe(1);
    expect((await findApplicableRate({ companyId: 'c1', insuranceType: 'health', yearMonth: '2026-03', prefectureCode: '13' }))?.totalRate).toBe(9);
  });

  it('組合健保は保険者が一致する料率を優先する', async () => {
    put('kyokai', { insuranceType: 'health', prefectureCode: '13', insurerId: 'kyokai', appliedFrom: '2026-03', totalRate: 1 });
    put('union', { insuranceType: 'health', prefectureCode: '', insurerId: 'TJK001', appliedFrom: '2026-03', totalRate: 5 });
    expect((await findApplicableRate({ companyId: 'c1', insuranceType: 'health', yearMonth: '2026-10', prefectureCode: '13', insurerId: 'TJK001' }))?.totalRate).toBe(5);
  });

  it('厚生年金は全国一律（都道府県・保険者を問わない）', async () => {
    put('p', { insuranceType: 'pension', prefectureCode: '', insurerId: 'kyokai', appliedFrom: '2017-09' });
    expect(await findApplicableRate({ companyId: 'c1', insuranceType: 'pension', yearMonth: '2026-10', prefectureCode: '27', insurerId: 'TJK001' })).not.toBeNull();
  });

  it('他の組合の料率は使わない', () => {
    expect(rateMatchScore({ prefectureCode: '', insurerId: 'OTHER' }, { insuranceType: 'longTermCare', prefectureCode: '13', insurerId: 'TJK001' })).toBeNull();
    expect(rateMatchScore({ prefectureCode: '', insurerId: '' }, { insuranceType: 'longTermCare', prefectureCode: '13', insurerId: 'TJK001' })).toBe(1);
  });
});
