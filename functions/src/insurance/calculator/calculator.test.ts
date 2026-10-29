import {
  splitPremium, employerOnlyPremium, normalizeRoundingRule,
  lookupGrade, judgeGradeChange, HEALTH_GRADE_TABLE, PENSION_GRADE_TABLE, resolveGradeTable, isValidGradeTable,
  selectSanteiMonths, occasionalRevisionAverage, MonthlyRemuneration,
  isMonthlyPremiumExempt, isBonusPremiumExempt, exemptMonths, maternityLeavePeriod,
  coverageForMonth, lossDateFromResignation,
  acquisitionRemuneration, monthlyHoursFromWeekly, remunerationForJudgement,
  correspondingDayNextMonth, judgeApplicability, eligibilityByAge, ageReachDate,
} from './index';

describe('端数処理', () => {
  it('本人負担は50銭以下切捨て・50銭超切上げ', () => {
    expect(splitPremium(10_000, 49.55, 49.55, 'statutory').employeeAmount).toBe(495); // 495.5
    expect(splitPremium(1_000, 0.51, 0.51, 'statutory').employeeAmount).toBe(1); // 0.51
    expect(splitPremium(98_000, 49.55, 49.55, 'statutory').employeeAmount).toBe(4856); // 4855.9
  });

  it('労使協定などの別ルール', () => {
    expect(splitPremium(10_000, 49.55, 49.55, 'round').employeeAmount).toBe(496);
    expect(splitPremium(10_000, 49.55, 49.55, 'truncate').employeeAmount).toBe(495);
    expect(splitPremium(10_100, 49.55, 49.55, 'ceil').employeeAmount).toBe(501); // 500.455
    expect(splitPremium(300_000, 49.55, 49.55, 'ceil').employeeAmount).toBe(14_865); // 端数なし
  });

  it('会社負担は全額（円未満切捨て）から本人負担を引いた額', () => {
    expect(splitPremium(10_000, 49.55, 49.55, 'statutory')).toEqual({ employeeAmount: 495, employerAmount: 496 });
    expect(splitPremium(98_000, 49.55, 49.55, 'statutory')).toEqual({ employeeAmount: 4856, employerAmount: 4855 });
    expect(splitPremium(300_000, 91.5, 91.5, 'statutory')).toEqual({ employeeAmount: 27_450, employerAmount: 27_450 });
  });

  it('組合健保などで負担割合が異なる場合は全額の料率を使う', () => {
    expect(splitPremium(300_000, 40, 50, 'statutory', 90)).toEqual({ employeeAmount: 12_000, employerAmount: 15_000 });
  });

  it('浮動小数の誤差を持ち込まない', () => {
    expect(splitPremium(300_000, 1.15, 1.15, 'statutory')).toEqual({ employeeAmount: 345, employerAmount: 345 });
    expect(employerOnlyPremium(300_000, 3.6)).toEqual({ employeeAmount: 0, employerAmount: 1080 });
  });

  it('旧データの未設定は法定ルールとして扱う', () => {
    expect(normalizeRoundingRule(undefined)).toBe('statutory');
    expect(normalizeRoundingRule('truncate')).toBe('truncate');
  });
});

describe('等級表', () => {
  it('公式の等級数と端の値', () => {
    expect(HEALTH_GRADE_TABLE).toHaveLength(50);
    expect(PENSION_GRADE_TABLE).toHaveLength(32);
    expect(PENSION_GRADE_TABLE[0]).toEqual({ gradeNumber: 1, standardRemuneration: 88_000, lowerBound: 0, upperBound: 93_000 });
    expect(PENSION_GRADE_TABLE[31].standardRemuneration).toBe(650_000);
    expect(PENSION_GRADE_TABLE[31].lowerBound).toBe(635_000);
    expect(isValidGradeTable(HEALTH_GRADE_TABLE)).toBe(true);
  });

  it.each([
    [62_999, 1], [63_000, 2], [100_999, 5], [101_000, 6], [394_999, 26], [395_000, 27],
    [1_294_999, 48], [1_295_000, 49], [1_354_999, 49], [1_355_000, 50], [10_000_000, 50], [0, 1],
  ])('健保：報酬月額 %i 円は %i 等級', (amount, grade) => {
    expect(lookupGrade(HEALTH_GRADE_TABLE, amount).gradeNumber).toBe(grade);
  });

  it.each([[92_999, 1], [93_000, 2], [634_999, 31], [635_000, 32], [2_000_000, 32]])('厚年：報酬月額 %i 円は %i 等級', (amount, grade) => {
    expect(lookupGrade(PENSION_GRADE_TABLE, amount).gradeNumber).toBe(grade);
  });

  it('料率マスタの等級表が壊れていれば公式の表を使う', () => {
    expect(resolveGradeTable('health', [{ gradeNumber: 1, standardRemuneration: 58_000, lowerBound: 10, upperBound: 63_000 }])).toBe(HEALTH_GRADE_TABLE);
    expect(resolveGradeTable('pension', null)).toBe(PENSION_GRADE_TABLE);
  });
});

describe('随時改定の等級差', () => {
  const base = { kind: 'health' as const, table: HEALTH_GRADE_TABLE, minDiff: 2 };

  it('2等級以上の差で改定対象', () => {
    const r = judgeGradeChange({ ...base, currentStandard: 300_000, averageRemuneration: 345_000, direction: 'up' });
    expect(r).toMatchObject({ eligible: true, gradeDiff: 2 });
    expect(r.newGrade.standardRemuneration).toBe(340_000);
  });

  it('1等級差は対象外', () => {
    expect(judgeGradeChange({ ...base, currentStandard: 300_000, averageRemuneration: 315_000, direction: 'up' }).eligible).toBe(false);
  });

  it('昇給なのに等級が下がる場合は対象外', () => {
    const r = judgeGradeChange({ ...base, currentStandard: 300_000, averageRemuneration: 250_000, direction: 'up' });
    expect(r.eligible).toBe(false);
    expect(r.reason).toContain('変動方向');
  });

  it('上限の特例：健保49等級から報酬月額1,415,000円以上で50等級', () => {
    expect(judgeGradeChange({ ...base, currentStandard: 1_330_000, averageRemuneration: 1_415_000, direction: 'up' })).toMatchObject({ eligible: true, gradeDiff: 1 });
    expect(judgeGradeChange({ ...base, currentStandard: 1_330_000, averageRemuneration: 1_414_999, direction: 'up' }).eligible).toBe(false);
  });

  it('上限の特例：厚年31等級から報酬月額665,000円以上で32等級', () => {
    expect(judgeGradeChange({ ...base, kind: 'pension', table: PENSION_GRADE_TABLE, currentStandard: 620_000, averageRemuneration: 665_000, direction: 'up' }).eligible).toBe(true);
  });

  it('下限の特例は従前の報酬月額が分からなければ担当者確認', () => {
    const unknown = judgeGradeChange({ ...base, currentStandard: 58_000, averageRemuneration: 64_000, direction: 'up' });
    expect(unknown).toMatchObject({ eligible: false, needsReview: true });
    expect(judgeGradeChange({ ...base, currentStandard: 58_000, averageRemuneration: 64_000, direction: 'up', previousRemuneration: 50_000 }).eligible).toBe(true);
    expect(judgeGradeChange({ ...base, currentStandard: 58_000, averageRemuneration: 64_000, direction: 'up', previousRemuneration: 60_000 }).eligible).toBe(false);
  });

  it('産休・育休終了時改定は1等級差でも対象', () => {
    expect(judgeGradeChange({ ...base, minDiff: 1, currentStandard: 300_000, averageRemuneration: 285_000, direction: 'down' })).toMatchObject({ eligible: true, gradeDiff: -1 });
  });
});

describe('支払基礎日数', () => {
  const months = (days: number[], amounts = [300_000, 310_000, 320_000]): MonthlyRemuneration[] =>
    days.map((d, i) => ({ yearMonth: `2026-0${4 + i}`, paymentBasisDays: d, remuneration: amounts[i] }));

  it('一般：17日以上の月だけで平均（円未満切捨て）', () => {
    const r = selectSanteiMonths(months([18, 16, 20], [300_001, 0, 300_000]), 'general');
    expect(r.basis).toBe('days17');
    expect(r.usedMonths.map(m => m.yearMonth)).toEqual(['2026-04', '2026-06']);
    expect(r.average).toBe(300_000);
  });

  it('パート：17日以上の月がなければ15日以上の月で算出', () => {
    expect(selectSanteiMonths(months([16, 15, 14]), 'partTimer')).toMatchObject({ basis: 'days15', average: 305_000 });
    expect(selectSanteiMonths(months([17, 16, 15]), 'partTimer')).toMatchObject({ basis: 'days17', average: 300_000 });
  });

  it('短時間労働者：11日以上', () => {
    expect(selectSanteiMonths(months([11, 10, 12]), 'shortTime')).toMatchObject({ basis: 'days11', average: 310_000 });
  });

  it('基準を満たす月がなければ対応要', () => {
    expect(selectSanteiMonths(months([16, 15, 14]), 'general')).toMatchObject({ basis: 'none', average: null });
  });

  it('随時改定は3か月すべてが基準日数以上（パートも17日）', () => {
    expect(occasionalRevisionAverage(months([17, 17, 16]), 'partTimer')).toMatchObject({ allMonthsQualified: false, shortMonths: ['2026-06'] });
    expect(occasionalRevisionAverage(months([11, 11, 11]), 'shortTime')).toMatchObject({ allMonthsQualified: true, average: 310_000 });
  });
});

describe('産休・育休の免除', () => {
  it('育休：同じ月の中で14日以上なら免除', () => {
    expect(isMonthlyPremiumExempt({ kind: 'childcare', start: '2026-10-10', end: '2026-10-23' }, '2026-10')).toBe(true);
    expect(isMonthlyPremiumExempt({ kind: 'childcare', start: '2026-10-10', end: '2026-10-22' }, '2026-10')).toBe(false);
  });

  it('産休には14日の基準がない', () => {
    expect(isMonthlyPremiumExempt({ kind: 'maternity', start: '2026-10-10', end: '2026-10-23' }, '2026-10')).toBe(false);
  });

  it('月末を含む月が免除。終了日の翌日が属する月は免除しない', () => {
    const leave = { kind: 'childcare' as const, start: '2026-10-20', end: '2027-01-15' };
    expect(exemptMonths(leave)).toEqual(['2026-10', '2026-11', '2026-12']);
    expect(isMonthlyPremiumExempt({ kind: 'childcare', start: '2026-10-01', end: '2026-10-31' }, '2026-10')).toBe(true);
    expect(exemptMonths({ kind: 'maternity', start: '2026-10-30', end: '2027-02-04' })).toEqual(['2026-10', '2026-11', '2026-12', '2027-01']);
  });

  it('育休の賞与免除は月末を含み、かつ1か月を超える場合', () => {
    expect(isBonusPremiumExempt({ kind: 'childcare', start: '2026-12-01', end: '2026-12-31' }, '2026-12')).toBe(false);
    expect(isBonusPremiumExempt({ kind: 'childcare', start: '2026-12-01', end: '2027-01-01' }, '2026-12')).toBe(true);
    expect(isBonusPremiumExempt({ kind: 'childcare', start: '2026-12-10', end: '2026-12-30' }, '2026-12')).toBe(false);
  });

  it('産休の賞与免除は月末を含めば免除', () => {
    expect(isBonusPremiumExempt({ kind: 'maternity', start: '2026-12-20', end: '2026-12-31' }, '2026-12')).toBe(true);
  });

  it('1か月後の応当日（応当日がない月は翌月1日）', () => {
    expect(correspondingDayNextMonth('2026-01-10')).toBe('2026-02-10');
    expect(correspondingDayNextMonth('2026-01-31')).toBe('2026-03-01');
    expect(correspondingDayNextMonth('2026-12-15')).toBe('2027-01-15');
  });

  it('産前42日・産後56日', () => {
    expect(maternityLeavePeriod({ expectedBirthDate: '2026-12-10' })).toEqual({ start: '2026-10-30', end: '2027-02-04' });
    expect(maternityLeavePeriod({ expectedBirthDate: '2026-12-10', actualBirthDate: '2026-12-15' })).toEqual({ start: '2026-10-30', end: '2027-02-09' });
    expect(maternityLeavePeriod({ expectedBirthDate: '2026-12-10', actualBirthDate: '2026-12-05' })).toEqual({ start: '2026-10-25', end: '2027-01-30' });
    expect(maternityLeavePeriod({ expectedBirthDate: '2026-12-10', multiple: true }).start).toBe('2026-09-04');
  });
});

describe('資格取得月・喪失月', () => {
  it('取得月は月の途中でも発生', () => {
    expect(coverageForMonth('2026-10-15', null, '2026-10').charged).toBe(true);
    expect(coverageForMonth('2026-10-15', null, '2026-09').charged).toBe(false);
  });

  it('月末退職は退職月も発生し、月の途中の退職は退職月に発生しない', () => {
    expect(lossDateFromResignation('2026-10-31')).toBe('2026-11-01');
    expect(coverageForMonth('2020-04-01', lossDateFromResignation('2026-10-31'), '2026-10').charged).toBe(true);
    expect(coverageForMonth('2020-04-01', lossDateFromResignation('2026-10-31'), '2026-11').charged).toBe(false);
    expect(coverageForMonth('2020-04-01', lossDateFromResignation('2026-10-30'), '2026-10').charged).toBe(false);
  });

  it('同月得喪は1か月分が発生', () => {
    expect(coverageForMonth('2026-10-05', lossDateFromResignation('2026-10-20'), '2026-10')).toMatchObject({ charged: true, sameMonthAcquisitionAndLoss: true });
    expect(coverageForMonth('2026-10-05', lossDateFromResignation('2026-10-31'), '2026-10')).toMatchObject({ charged: true, sameMonthAcquisitionAndLoss: false });
  });
});

describe('報酬月額', () => {
  it('資格取得時：月給・日給・時給', () => {
    expect(acquisitionRemuneration({ wageType: 'monthly', wageAmount: 250_000, allowances: 12_000 })).toBe(262_000);
    expect(acquisitionRemuneration({ wageType: 'daily', wageAmount: 10_000, monthlyDays: 20, allowances: 5_000 })).toBe(205_000);
    expect(acquisitionRemuneration({ wageType: 'hourly', wageAmount: 1_200, monthlyHours: monthlyHoursFromWeekly(20) })).toBe(103_920);
    expect(() => acquisitionRemuneration({ wageType: 'hourly', wageAmount: 1_200 })).toThrow();
  });

  it('判定用の報酬月額は現物を含み遡及差額を除く', () => {
    expect(remunerationForJudgement({ totalSalary: 320_000, inKind: 20_000, retroactiveAmount: 30_000 })).toBe(310_000);
  });
});

describe('社会保険の適用判定', () => {
  const base = {
    employmentType: 'regular' as const, weeklyHours: 40, monthlyDays: 21, fullTimeWeeklyHours: 40, fullTimeMonthlyDays: 21,
    isSpecificApplicableOffice: true, contractType: 'indefinite' as const, renewalExpected: false, isStudent: false,
  };

  it('3/4基準：時間と日数がともに3/4以上なら適用（ちょうど3/4を含む）', () => {
    expect(judgeApplicability({ ...base, employmentType: 'partTime', weeklyHours: 30, monthlyDays: 15 })).toMatchObject({ result: 'applicable', applicabilityReason: 'specificShortTime' });
    expect(judgeApplicability({ ...base, employmentType: 'partTime', weeklyHours: 30, monthlyDays: 15.75 })).toMatchObject({ result: 'applicable', applicabilityReason: 'standard', insuredCategory: 'partTimer' });
    expect(judgeApplicability(base)).toMatchObject({ result: 'applicable', insuredCategory: 'general' });
  });

  it('特定適用事業所の短時間労働者：週20時間以上・学生でない', () => {
    expect(judgeApplicability({ ...base, employmentType: 'partTime', weeklyHours: 20, monthlyDays: 12 })).toMatchObject({ result: 'applicable', insuredCategory: 'shortTime' });
    expect(judgeApplicability({ ...base, employmentType: 'partTime', weeklyHours: 19.5, monthlyDays: 12 }).result).toBe('notApplicable');
    expect(judgeApplicability({ ...base, employmentType: 'arbeit', weeklyHours: 20, monthlyDays: 12, isStudent: true }).result).toBe('notApplicable');
  });

  it('特定適用事業所でなければ3/4未満は適用外。未登録なら担当者判断', () => {
    expect(judgeApplicability({ ...base, employmentType: 'partTime', weeklyHours: 20, monthlyDays: 12, isSpecificApplicableOffice: false }).result).toBe('notApplicable');
    expect(judgeApplicability({ ...base, employmentType: 'partTime', weeklyHours: 20, monthlyDays: 12, isSpecificApplicableOffice: null }).result).toBe('manual');
  });

  it('2か月以内の有期契約で更新見込みがなければ適用外', () => {
    const fixed = { ...base, contractType: 'fixed' as const, contractStartDate: '2026-10-01' };
    expect(judgeApplicability({ ...fixed, contractEndDate: '2026-11-30' }).result).toBe('notApplicable');
    expect(judgeApplicability({ ...fixed, contractEndDate: '2026-12-01' }).result).toBe('applicable');
    expect(judgeApplicability({ ...fixed, contractEndDate: '2026-11-30', renewalExpected: true }).result).toBe('applicable');
  });

  it('非常勤役員は自動判定しない。常勤役員は通常どおり判定', () => {
    expect(judgeApplicability({ ...base, employmentType: 'executivePart' }).result).toBe('manual');
    expect(judgeApplicability({ ...base, employmentType: 'executiveFull' }).result).toBe('applicable');
  });
});

describe('年齢による加入', () => {
  it('年齢の到達日は誕生日の前日', () => {
    expect(ageReachDate('1986-04-01', 40)).toBe('2026-03-31');
    // 2/29生まれは平年の2/28に到達する
    expect(ageReachDate('1988-02-29', 40)).toBe('2028-02-28');
    expect(ageReachDate('1984-02-29', 41)).toBe('2025-02-28');
  });

  it('介護保険は40歳到達日から65歳到達日の前日まで', () => {
    expect(eligibilityByAge('1986-04-02', '2026-03-31').longTermCare).toBe(false);
    expect(eligibilityByAge('1986-04-02', '2026-04-01').longTermCare).toBe(true);
    expect(eligibilityByAge('1961-11-02', '2026-10-31').longTermCare).toBe(true);
    expect(eligibilityByAge('1961-11-02', '2026-11-01').longTermCare).toBe(false);
  });

  it('厚生年金は70歳到達日から、健康保険は75歳の誕生日から加入しない', () => {
    const at70 = eligibilityByAge('1956-11-02', '2026-11-01');
    expect(at70.pension).toBe(false);
    expect(at70.health).toBe(true);
    expect(eligibilityByAge('1956-11-02', '2026-10-31').pension).toBe(true);
    expect(eligibilityByAge('1951-11-02', '2026-11-01').health).toBe(true);
    const at75 = eligibilityByAge('1951-11-02', '2026-11-02');
    expect(at75.health).toBe(false);
    expect(at75.longTermCare).toBe(false);
    expect(at75.notes).toHaveLength(2);
  });
});
