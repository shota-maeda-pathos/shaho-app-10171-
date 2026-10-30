import { changeEffect, changeNotes, qualificationDateOf } from './rules';

describe('雇用条件の変更', () => {
  it('加入の切り替わり', () => {
    expect(changeEffect({ health: true, pension: true }, { health: false, pension: false })).toBe('lose');
    expect(changeEffect({ health: false, pension: false }, { health: true, pension: true })).toBe('acquire');
    expect(changeEffect({ health: true, pension: true }, { health: true, pension: true })).toBe('none');
    expect(changeEffect(null, { health: true, pension: false })).toBe('acquire');
  });
  it('取得日は新しい条件の初日、喪失日はその翌日', () => {
    expect(qualificationDateOf('acquire', '2026-12-01')).toBe('2026-12-01');
    expect(qualificationDateOf('lose', '2026-12-01')).toBe('2026-12-02');
    expect(qualificationDateOf('none', '2026-12-01')).toBeNull();
  });
  it('固定的賃金・区分・契約期間の変化を知らせる', () => {
    const notes = changeNotes({
      effect: 'none', enrolledAfter: true, fixedBefore: 300_000, fixedAfter: 330_000,
      categoryBefore: 'general', categoryAfter: 'partTimer', contractEndBefore: '2026-11-30', contractEndAfter: '2027-11-30',
    });
    expect(notes).toHaveLength(3);
    expect(changeNotes({ effect: 'lose', enrolledAfter: false, fixedBefore: 300_000, fixedAfter: 100_000, categoryBefore: 'general', categoryAfter: 'general', contractEndBefore: null, contractEndAfter: null })).toEqual([]);
  });
});
