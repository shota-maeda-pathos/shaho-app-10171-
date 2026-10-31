import { addDays, ageReachedIn, nextMonth, within } from './rules';

describe('サマリーの決まり', () => {
  it('年齢到達は誕生日の前日の月で数える', () => {
    expect(ageReachedIn('1986-12-01', '2026-11')).toBe(40);
    expect(ageReachedIn('1986-12-02', '2026-11')).toBeNull();
    expect(ageReachedIn('1961-11-15', '2026-11')).toBe(65);
  });
  it('日付の計算', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(nextMonth('2026-12')).toBe('2027-01');
    expect(within('2026-12-02', '2026-11-01', 30)).toBe(false);
    expect(within('2026-11-30', '2026-11-01', 29)).toBe(true);
    expect(within(null, '2026-11-01', 30)).toBe(false);
  });
});
