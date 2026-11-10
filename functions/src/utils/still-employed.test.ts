import { stillEmployedOn } from './employment';

describe('stillEmployedOn', () => {
  it('退職日までは在籍中、退職日の翌日から在籍でない', () => {
    expect(stillEmployedOn('2026-11-30', '2026-11-10')).toBe(true);
    expect(stillEmployedOn('2026-11-10', '2026-11-10')).toBe(true);
    expect(stillEmployedOn('2026-11-09', '2026-11-10')).toBe(false);
    expect(stillEmployedOn('2026-11-30T00:00:00.000Z', '2026-12-01')).toBe(false);
  });
});
