import { PENSION_GRADE_TABLE } from '../insurance/calculator';
import { deadlineOf, milestoneFacts, milestonesBetween, pension70Filing, remunerationEstimate } from './rules';

describe('年齢到達の日と保険料の月', () => {
  it('月の途中生まれ', () => {
    expect(milestoneFacts('1956-11-15', 70)).toMatchObject({ reachDate: '2026-11-14', eventDate: '2026-11-14', changeMonth: '2026-11', kind: 'pension70' });
    expect(milestoneFacts('1951-12-20', 75)).toMatchObject({ reachDate: '2026-12-19', eventDate: '2026-12-20', changeMonth: '2026-12', kind: 'health75' });
    expect(milestoneFacts('1986-11-10', 40)).toMatchObject({ eventDate: '2026-11-09', changeMonth: '2026-11', kind: null });
  });

  it('月の1日生まれは、70歳は前月、75歳は当月に喪失', () => {
    const p = milestoneFacts('1956-12-01', 70);
    expect(p.eventDate).toBe('2026-11-30');
    expect(p.effect).toContain('2026年10月分まで');
    const h = milestoneFacts('1951-12-01', 75);
    expect(h.eventDate).toBe('2026-12-01');
    expect(h.effect).toContain('2026年11月分まで');
  });

  it('2月29日生まれ', () => {
    // 平年の誕生日は3月1日、到達日は2月28日
    expect(milestoneFacts('1956-02-29', 70).eventDate).toBe('2026-02-28');
    expect(milestoneFacts('1951-02-29', 75).eventDate).toBe('2026-03-01');
  });

  it('期間に起きる年齢到達だけを返す', () => {
    expect(milestonesBetween('1956-11-15', '2026-11-01', '2026-12-31').map(m => m.age)).toEqual([70]);
    expect(milestonesBetween('1961-12-05', '2026-11-01', '2026-12-31').map(m => m.age)).toEqual([65]);
    expect(milestonesBetween('1990-01-01', '2026-11-01', '2026-12-31')).toEqual([]);
  });

  it('届出の期限は起きた日から5日', () => {
    expect(deadlineOf('2026-11-14')).toBe('2026-11-19');
  });
});

describe('70歳到達の届出の要否', () => {
  it('相当額が到達前と同じなら不要、違えば要る', () => {
    expect(pension70Filing({ remuneration: 305_000, currentPensionStandard: 300_000, pensionTable: PENSION_GRADE_TABLE }).filingRequired).toBe(false);
    const diff = pension70Filing({ remuneration: 250_000, currentPensionStandard: 300_000, pensionTable: PENSION_GRADE_TABLE });
    expect(diff.filingRequired).toBe(true);
    expect(diff.equivalentStandard).toBe(260_000);
  });
  it('報酬月額がなければ判定しない。到達前の等級がなければ届け出る', () => {
    expect(pension70Filing({ remuneration: null, currentPensionStandard: 300_000, pensionTable: PENSION_GRADE_TABLE }).filingRequired).toBeNull();
    expect(pension70Filing({ remuneration: 300_000, currentPensionStandard: null, pensionTable: PENSION_GRADE_TABLE }).filingRequired).toBe(true);
  });
  it('報酬月額の目安は直近の固定的賃金＋3か月の非固定的賃金の平均', () => {
    expect(remunerationEstimate([
      { totalFixedWage: 280_000, totalVariableWage: 30_000, inKind: 0 },
      { totalFixedWage: 300_000, totalVariableWage: 0, inKind: 0 },
      { totalFixedWage: 300_000, totalVariableWage: 15_000, inKind: 0 },
      { totalFixedWage: 300_000, totalVariableWage: 90_000, inKind: 0 },
    ])).toBe(295_000);
    expect(remunerationEstimate([])).toBeNull();
  });
});
