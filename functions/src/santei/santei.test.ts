import { HEALTH_GRADE_TABLE, PENSION_GRADE_TABLE } from '../insurance/calculator';
import {
  computeSanteiRow, NO_APPROVAL, SanteiEmployeeData, santeiApprovalMetadata, santeiFilingPerson, santeiMetadataMatches,
} from './santei-calc';
import { buildSanteiSample } from './sample';

const tables = { health: HEALTH_GRADE_TABLE, pension: PENSION_GRADE_TABLE };
const salary = (total: number, days = 20, isConfirmed = true, extra: Record<string, unknown> = {}) =>
  ({ totalSalary: total, paymentBasisDays: days, isConfirmed, totalFixedWage: total, ...extra } as never);
const data = (overrides: Partial<SanteiEmployeeData> = {}): SanteiEmployeeData => ({
  employeeId: 'emp-001', employeeNumber: '001', employeeName: '山田 太郎',
  acquisitionDate: '2020-04-01', lossDate: null, enrolled: true, insuredCategory: 'general',
  salaries: { '2026-04': salary(300_000), '2026-05': salary(310_000), '2026-06': salary(320_000) },
  currentGrade: { effectiveMonth: '2025-09', healthGradeNumber: 22, healthStandardRemuneration: 300_000, pensionGradeNumber: 19, pensionStandardRemuneration: 300_000 } as never,
  hasOccasionalRevisionJulToSep: false, approval: NO_APPROVAL, decision: null,
  ...overrides,
});

describe('computeSanteiRow', () => {
  it('3か月平均から健保・厚年の等級を別々に決める', () => {
    const r = computeSanteiRow(2026, data(), tables);
    expect(r).toMatchObject({ status: 'ok', average: 310_000, basis: 'days17', changed: true, currentEffectiveMonth: '2025-09' });
    expect(r.proposed).toEqual({ healthGradeNumber: 23, healthStandardRemuneration: 320_000, pensionGradeNumber: 20, pensionStandardRemuneration: 320_000 });
  });

  it('平均額をそのまま標準報酬月額にしない（等級表に当てはめる）', () => {
    const r = computeSanteiRow(2026, data({ salaries: { '2026-04': salary(333_333), '2026-05': salary(333_333), '2026-06': salary(333_334) } }), tables);
    expect(r.average).toBe(333_333);
    expect(r.proposed!.healthStandardRemuneration).toBe(340_000);
  });

  it('17日未満の月を除いて平均する', () => {
    const r = computeSanteiRow(2026, data({ salaries: { '2026-04': salary(300_000, 20), '2026-05': salary(100_000, 10), '2026-06': salary(320_000, 18) } }), tables);
    expect(r.average).toBe(310_000);
    expect(r.months.map(m => m.used)).toEqual([true, false, true]);
    expect(r.reason).toBe('4月・6月の平均');
  });

  it('パートは17日以上の月がなければ15日以上の月で算定', () => {
    const r = computeSanteiRow(2026, data({ insuredCategory: 'partTimer', salaries: { '2026-04': salary(150_000, 16), '2026-05': salary(140_000, 15), '2026-06': salary(120_000, 14) } }), tables);
    expect(r).toMatchObject({ status: 'ok', basis: 'days15', average: 145_000 });
    expect(r.reason).toContain('パートの15日特例');
  });

  it('短時間労働者は11日以上の月で算定', () => {
    const r = computeSanteiRow(2026, data({ insuredCategory: 'shortTime', salaries: { '2026-04': salary(100_000, 12), '2026-05': salary(90_000, 11), '2026-06': salary(50_000, 9) } }), tables);
    expect(r).toMatchObject({ status: 'ok', basis: 'days11', average: 95_000 });
  });

  it('基準を満たす月がなければ対応要。従前の標準報酬月額で決めると対象になる（等級は変わらない）', () => {
    const short = { '2026-04': salary(100_000, 10), '2026-05': salary(100_000, 10), '2026-06': salary(100_000, 10) };
    expect(computeSanteiRow(2026, data({ salaries: short }), tables).status).toBe('needsAction');
    const decided = computeSanteiRow(2026, data({ salaries: short, decision: 'previous' }), tables);
    expect(decided).toMatchObject({ status: 'ok', basis: 'previous', changed: false, decision: 'previous' });
    expect(decided.proposed).toEqual(decided.current);
  });

  it('今の等級がなければ、従前で決めると選んでも対応要のまま', () => {
    const short = { '2026-04': salary(100_000, 10), '2026-05': salary(100_000, 10), '2026-06': salary(100_000, 10) };
    const r = computeSanteiRow(2026, data({ salaries: short, decision: 'previous', currentGrade: null }), tables);
    expect(r.status).toBe('needsAction');
    expect(r.reason).toContain('今の等級もない');
  });

  it.each([
    [{ acquisitionDate: '2026-06-01' }, '6月1日以降'],
    [{ lossDate: '2026-07-01' }, '7月1日まで'],
    [{ hasOccasionalRevisionJulToSep: true }, '随時改定'],
    [{ enrolled: false }, '適用外'],
  ])('除外：%j', (override, reason) => {
    const r = computeSanteiRow(2026, data(override as Partial<SanteiEmployeeData>), tables);
    expect(r.status).toBe('excluded');
    expect(r.reason).toContain(reason);
  });

  it('5月1日の取得は対象。資格取得前の4月は使わない', () => {
    const r = computeSanteiRow(2026, data({ acquisitionDate: '2026-05-01', salaries: { '2026-04': null, '2026-05': salary(300_000), '2026-06': salary(300_000) } }), tables);
    expect(r.status).toBe('ok');
    expect(r.months.map(m => m.yearMonth)).toEqual(['2026-05', '2026-06']);
  });

  it('給与が未登録・未承認なら保留（他の人は止めない）', () => {
    const r = computeSanteiRow(2026, data({ salaries: { '2026-04': salary(300_000), '2026-05': null, '2026-06': salary(300_000, 20, false) } }), tables);
    expect(r.status).toBe('pending');
    expect(r.reason).toContain('5月の給与が未登録');
    expect(r.reason).toContain('6月の給与が未承認');
  });

  it('等級が変わらなくても対象（変更なしとして表示）', () => {
    const r = computeSanteiRow(2026, data({ salaries: { '2026-04': salary(300_000), '2026-05': salary(300_000), '2026-06': salary(300_000) } }), tables);
    expect(r).toMatchObject({ status: 'ok', changed: false });
  });

  it('遡及差額は判定から除くが、届出の通貨には含める', () => {
    const r = computeSanteiRow(2026, data({ salaries: {
      '2026-04': salary(300_000), '2026-05': salary(300_000), '2026-06': salary(330_000, 20, true, { retroactivePay: { amount: 30_000, fromMonth: '2026-04', toMonth: '2026-05' } }),
    } }), tables);
    expect(r.average).toBe(300_000);
    expect(r.months[2]).toMatchObject({ cash: 330_000, remuneration: 300_000, retroactive: 30_000 });
  });
});

describe('承認申請の内容と届出の行', () => {
  it('承認申請の内容に、届出に使う月ごとの値を残す', () => {
    const meta = santeiApprovalMetadata(2026, computeSanteiRow(2026, data(), tables));
    expect(meta).toMatchObject({
      effectiveMonth: '2026-09', determinationType: 'regular', healthGradeNumber: 23, basisRemuneration: 310_000,
      basisMonths: ['2026-04', '2026-05', '2026-06'], previousGradeMonth: '2025-09', source: 'santei',
    });
    expect(meta.months).toHaveLength(3);
    expect(meta.reason).toContain('4月・5月・6月の平均 310,000円');
  });

  it('依頼した後に給与が変わって等級や使う月が変われば、内容が一致しない', () => {
    const meta = santeiApprovalMetadata(2026, computeSanteiRow(2026, data(), tables));
    expect(santeiMetadataMatches(meta, computeSanteiRow(2026, data(), tables))).toBe(true);
    const changed = computeSanteiRow(2026, data({ salaries: { '2026-04': salary(400_000), '2026-05': salary(400_000), '2026-06': salary(400_000) } }), tables);
    expect(santeiMetadataMatches(meta, changed)).toBe(false);
    const fewerMonths = computeSanteiRow(2026, data({ salaries: { '2026-04': salary(310_000), '2026-05': salary(310_000, 10), '2026-06': salary(310_000) } }), tables);
    expect(fewerMonths.proposed).toEqual(computeSanteiRow(2026, data(), tables).proposed);
    expect(santeiMetadataMatches(meta, fewerMonths)).toBe(false);
  });

  it('届出の総計・平均額は基準を満たした月の支払額。遡及支払があれば修正平均額を書く', () => {
    const row = computeSanteiRow(2026, data({ salaries: {
      '2026-04': salary(300_000), '2026-05': salary(300_000, 10), '2026-06': salary(331_000, 20, true, { retroactivePay: { amount: 30_000, fromMonth: '2026-04', toMonth: '2026-05' } }),
    } }), tables);
    const p = santeiFilingPerson({ employeeId: 'emp-001', insuredPersonNumber: '12', name: '山田 太郎', birthDate: '1980-01-01', meta: santeiApprovalMetadata(2026, row), age70: false });
    expect(p.months.map(m => m.月)).toEqual([4, 5, 6]);
    expect(p.総計).toBe(631_000);
    expect(p.平均額).toBe(315_500);
    expect(p.修正平均額).toBe(300_500);
    expect(p.従前の改定月).toBe('2025-09');
    expect(p.備考).toContain('遡及支払額あり');
    expect(p.備考区分).toEqual([9]);
    expect(p.備考その他).toBe('遡及支払額あり');
  });

  it('5月に資格を取った人は途中入社', () => {
    const row = computeSanteiRow(2026, data({ acquisitionDate: '2026-05-01', salaries: { '2026-04': null, '2026-05': salary(300_000), '2026-06': salary(300_000) } }), tables);
    const p = santeiFilingPerson({ employeeId: 'e', insuredPersonNumber: '', name: '山田 太郎', birthDate: '1990-01-01', meta: santeiApprovalMetadata(2026, row), age70: false });
    expect(p.備考区分).toEqual([4]);
    expect(p.months.map(m => m.月)).toEqual([5, 6]);
  });

  it('従前で決めた人とパート・70歳以上は備考に書く', () => {
    const short = { '2026-04': salary(100_000, 10), '2026-05': salary(100_000, 10), '2026-06': salary(100_000, 10) };
    const row = computeSanteiRow(2026, data({ salaries: short, decision: 'previous', insuredCategory: 'partTimer' }), tables);
    const p = santeiFilingPerson({ employeeId: 'e', insuredPersonNumber: '', name: '山田 太郎', birthDate: '1950-01-01', meta: santeiApprovalMetadata(2026, row), age70: true });
    expect(p.平均額).toBeNull();
    expect(p.備考).toBe('パート・支払基礎日数不足のため従前の標準報酬月額で決定・70歳以上被用者');
    expect(p.備考区分).toEqual([1, 7, 9]);
    expect(p.備考その他).toBe('従前の標準報酬月額で決定');
    expect(p.決定_健康保険等級).toBe(22);
  });
});

describe('算定テスト用のサンプル', () => {
  it('50人ごとに確かめたい場面が1人ずつ入る', () => {
    const sample = buildSanteiSample(300);
    expect(sample).toHaveLength(300);
    expect(new Set(sample.map(e => e.employeeNumber)).size).toBe(300);
    const by = (k: number) => sample.filter((_, i) => (i + 1) % 50 === k);
    expect(by(1).every(e => e.hireDate === '2026-06-15' && e.months.length === 0)).toBe(true);
    expect(by(3).every(e => e.months.find(m => m.yearMonth === '2026-06')!.confirmed === false)).toBe(true);
    expect(by(6).every(e => e.insuredCategory === 'partTimer')).toBe(true);
    expect(by(10).every(e => e.months.map(m => m.yearMonth).join() === '2026-05,2026-06')).toBe(true);
    expect(sample.filter(e => e.gradeRemuneration === null).length).toBeGreaterThan(0);
  });
});
