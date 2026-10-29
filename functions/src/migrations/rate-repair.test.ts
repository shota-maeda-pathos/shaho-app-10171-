jest.mock('../config', () => ({ db: {} }));
import { planRateRepair } from './rate-repair';

const base = { insurerId: '01130012', appliedUntil: null };
describe('料率マスタの修正', () => {
  it('小数の料率を‰に直し、令和7・8年度を足して、前の料率を前月で終わらせる', () => {
    const plan = planRateRepair([
      { ...base, id: 'h13', insuranceType: 'health', prefectureCode: '13', appliedFrom: '2024-04', totalRate: 0.0998, employeeRate: 0.0499, employerRate: 0.0499 },
      { ...base, id: 'p', insuranceType: 'pension', prefectureCode: '', appliedFrom: '2024-04', totalRate: 183, employeeRate: 91.5, employerRate: 91.5 },
    ]);
    expect(plan.find(p => p.id === 'h13' && p.change === 'unit')?.after).toEqual({ totalRate: 99.8, employeeRate: 49.9, employerRate: 49.9 });
    expect(plan.find(p => p.id === 'h13' && p.change === 'close')?.after).toEqual({ appliedUntil: '2025-02' });
    const added = plan.filter(p => p.change === 'add' && p.prefectureCode === '13');
    expect(added.map(p => [p.appliedFrom, p.after])).toEqual([
      ['2025-03', { totalRate: 99.1, employeeRate: 49.55, employerRate: 49.55, appliedUntil: '2026-02' }],
      ['2026-03', { totalRate: 98.5, employeeRate: 49.25, employerRate: 49.25, appliedUntil: null }],
    ]);
    expect(plan.some(p => p.id === 'p')).toBe(false);
  });

  it('合計が空の旧データは本人分と会社分の合計を入れる。サンプル用の保険者には足さず、健保の料率がない都道府県には足す', () => {
    const plan = planRateRepair([
      { ...base, id: 'p', insuranceType: 'pension', prefectureCode: '', appliedFrom: '2024-04', totalRate: null, employeeRate: 0.0915, employerRate: 0.0915 },
      { ...base, insurerId: 'sample-insurer', id: 's', insuranceType: 'health', prefectureCode: '28', appliedFrom: '2026-04', totalRate: 100, employeeRate: 50, employerRate: 50 },
    ]);
    expect(plan.find(p => p.id === 'p')?.after).toEqual({ totalRate: 183, employeeRate: 91.5, employerRate: 91.5 });
    // 監査ログに書くため undefined を含めない
    expect(Object.values(plan.find(p => p.id === 'p')!.before!).some(v => v === undefined)).toBe(false);
    expect('totalRate' in plan.find(p => p.id === 'p')!.before!).toBe(false);
    expect(plan.some(p => p.insurerId === 'sample-insurer')).toBe(false);
    expect(plan.filter(p => p.change === 'add').map(p => `${p.prefectureCode}:${p.appliedFrom}`)).toEqual(['13:2025-03', '13:2026-03', '27:2025-03', '27:2026-03', '28:2025-03', '28:2026-03']);
  });

  it('既にある年度は足さず、正しい料率は変えない', () => {
    const plan = planRateRepair([
      { ...base, id: 'a', insuranceType: 'health', prefectureCode: '13', appliedFrom: '2025-03', appliedUntil: '2026-02', totalRate: 99.1, employeeRate: 49.55, employerRate: 49.55 },
      { ...base, id: 'b', insuranceType: 'health', prefectureCode: '13', appliedFrom: '2026-03', totalRate: 98.5, employeeRate: 49.25, employerRate: 49.25 },
    ]);
    expect(plan.filter(p => p.prefectureCode === '13')).toEqual([]);
  });
});
