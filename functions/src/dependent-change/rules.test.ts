import { ageAtYearEnd, attachmentHints, dependentFilingDeadline, judgeDependent } from './rules';

const base = { relationship: 'child' as const, isDisabled: false, income: 0, coResident: true, eventDate: '2026-11-10' };

describe('ageAtYearEnd', () => {
  it('認定日が属する年の12月31日時点の年齢', () => {
    expect(ageAtYearEnd('2007-12-31', '2026-03-01')).toBe(19);
    expect(ageAtYearEnd('2008-01-02', '2026-03-01')).toBe(18);
  });
  it('1月1日生まれは前年の12月31日に年をとる', () => {
    expect(ageAtYearEnd('2008-01-01', '2026-03-01')).toBe(19);
  });
});

describe('judgeDependent', () => {
  it('原則は130万円未満。130万円ちょうどは基準以上', () => {
    expect(judgeDependent({ ...base, birthDate: '1990-05-01', relationship: 'sibling', income: 1_299_999 })).toMatchObject({ limit: 1_300_000, overLimit: false });
    expect(judgeDependent({ ...base, birthDate: '1990-05-01', relationship: 'sibling', income: 1_300_000 }).overLimit).toBe(true);
  });

  it('19歳以上23歳未満の子は150万円未満。配偶者には適用しない', () => {
    expect(judgeDependent({ ...base, birthDate: '2005-06-01', income: 1_400_000 })).toMatchObject({ limit: 1_500_000, overLimit: false });
    expect(judgeDependent({ ...base, birthDate: '2005-06-01', relationship: 'spouse', income: 1_400_000 })).toMatchObject({ limit: 1_300_000, overLimit: true });
  });

  it('23歳になる年は原則の基準', () => {
    expect(judgeDependent({ ...base, birthDate: '2003-12-30', income: 1_400_000 }).limit).toBe(1_300_000);
  });

  it('60歳以上・障害者は180万円未満', () => {
    expect(judgeDependent({ ...base, birthDate: '1966-12-31', relationship: 'parent', income: 1_700_000 })).toMatchObject({ limit: 1_800_000, overLimit: false });
    expect(judgeDependent({ ...base, birthDate: '1990-01-01', isDisabled: true, income: 1_700_000 }).basis).toContain('障害者');
  });

  it('75歳以上は扶養に入れない', () => {
    expect(judgeDependent({ ...base, birthDate: '1950-01-01', relationship: 'parent' }).lateElderly).toBe(true);
  });

  it('同居が要件の続柄で別居なら注意を出す', () => {
    expect(judgeDependent({ ...base, birthDate: '1960-01-01', relationship: 'other', coResident: false }).notes.join()).toContain('同居していることが要件');
  });

  it('20歳以上60歳未満の配偶者は第3号被保険者の届出を兼ねる', () => {
    expect(judgeDependent({ ...base, birthDate: '1995-01-01', relationship: 'spouse' }).thirdInsured).toBe(true);
    expect(judgeDependent({ ...base, birthDate: '1960-01-01', relationship: 'spouse' }).thirdInsured).toBe(false);
  });
});

describe('dependentFilingDeadline', () => {
  it('いちばん早い異動日から5日', () => {
    // 5日目の11月8日は日曜のため、翌日の9日まで延びる
    expect(dependentFilingDeadline(['2026-11-10', '2026-11-03'])).toBe('2026-11-09');
    expect(dependentFilingDeadline([])).toBeNull();
  });
});

describe('attachmentHints', () => {
  it('追加なら続柄・収入、別居なら仕送り', () => {
    const hints = attachmentHints([{ kind: 'add', relationship: 'parent', coResident: false, reason: '' }]);
    expect(hints.some(h => h.startsWith('続柄'))).toBe(true);
    expect(hints.some(h => h.includes('仕送り'))).toBe(true);
  });
});
