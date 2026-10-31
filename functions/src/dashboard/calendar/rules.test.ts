import { annualEvents, bonusEvents, monthlyChecklist } from './rules';

describe('カレンダーと今月やること', () => {
  it('毎年の予定に算定基礎届の期間（7/1〜10）がある', () => {
    expect(annualEvents(2027).find(e => e.title.includes('算定基礎届'))).toMatchObject({ start: '2027-07-01', end: '2027-07-10' });
  });
  it('賞与の予定月を事業所ごとに出す', () => {
    expect(bonusEvents(2026, [{ name: 'A', bonusMonths: [6, 12] }]).map(e => e.start)).toEqual(['2026-06-01', '2026-12-01']);
  });
  it('月によってやることが増える', () => {
    expect(monthlyChecklist('2026-07', false).map(i => i.key)).toContain('santei');
    expect(monthlyChecklist('2026-03', false).map(i => i.key)).toContain('rates');
    expect(monthlyChecklist('2026-12', true).map(i => i.key)).toContain('bonus');
    expect(monthlyChecklist('2026-11', false).map(i => i.key)).not.toContain('santei');
  });
});
