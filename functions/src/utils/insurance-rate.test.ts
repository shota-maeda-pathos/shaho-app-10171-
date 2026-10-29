import { MockFirestore } from '../__tests__/helpers';

let mockDb: MockFirestore;
jest.mock('../config', () => ({
  get db() {
    return mockDb;
  },
}));

import { findApplicableRate, rateMatchScore } from './insurance-rate';

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
