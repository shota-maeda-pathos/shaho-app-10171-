import { childcareLimits, judgeLeaveEvent, LeaveFacts, planChildcare, planMaternity, returnMonth } from './rules';

describe('planMaternity', () => {
  it('産前42日・産後56日。開始日を空にすると法律上いちばん早い日', () => {
    const p = planMaternity({ expectedBirthDate: '2027-03-10', actualBirthDate: null, multiple: false, startDate: '' });
    expect(p).toMatchObject({ start: '2027-01-28', end: '2027-05-05', errors: [] });
    // 1月〜4月の月末が休業中。5月5日に終わるので5月は免除されない
    expect(p.exemptMonths).toEqual(['2027-01', '2027-02', '2027-03', '2027-04']);
    expect(p.deadline).toBe('2027-06-05');
    expect(p.bonusExempt).toBe(true);
  });
  it('多胎は産前98日', () => {
    expect(planMaternity({ expectedBirthDate: '2027-03-10', actualBirthDate: null, multiple: true, startDate: '' }).start).toBe('2026-12-03');
  });
  it('いちばん早い日より前・出産の翌日より後には休み始められない', () => {
    expect(planMaternity({ expectedBirthDate: '2027-03-10', actualBirthDate: null, multiple: false, startDate: '2027-01-27' }).errors).toHaveLength(1);
    expect(planMaternity({ expectedBirthDate: '2027-03-10', actualBirthDate: null, multiple: false, startDate: '2027-03-11' }).errors).toEqual([]);
    expect(planMaternity({ expectedBirthDate: '2027-03-10', actualBirthDate: null, multiple: false, startDate: '2027-03-12' }).errors).toHaveLength(1);
  });
  it('出産後に申し出る場合は実際の出産日から産後を数える', () => {
    expect(planMaternity({ expectedBirthDate: '2027-03-10', actualBirthDate: '2027-03-15', multiple: false, startDate: '2027-02-01' }).end).toBe('2027-05-10');
  });
});

describe('planChildcare', () => {
  const base = { childBirthDate: '2027-03-10', bornByEmployee: true };
  it('終了予定日を空にすると子が1歳に達する日（誕生日の前日）', () => {
    const p = planChildcare({ ...base, startDate: '2027-05-06', endDate: '' });
    expect(p).toMatchObject({ end: '2028-03-09', stage: '1歳まで', errors: [] });
    expect(p.exemptMonths[0]).toBe('2027-05');
    expect(p.exemptMonths.at(-1)).toBe('2028-02');
  });
  it('本人が出産した子は、産後56日が過ぎてから', () => {
    expect(planChildcare({ ...base, startDate: '2027-05-05', endDate: '' }).errors).toHaveLength(1);
    expect(planChildcare({ ...base, bornByEmployee: false, startDate: '2027-03-10', endDate: '2027-03-31' }).errors).toEqual([]);
  });
  it('同じ月の中の14日未満の育休は月々も賞与も免除されない', () => {
    const p = planChildcare({ ...base, bornByEmployee: false, startDate: '2027-04-05', endDate: '2027-04-15' });
    expect(p.exemptMonths).toEqual([]);
    expect(p.bonusExempt).toBe(false);
    expect(p.notes.length).toBe(2);
  });
  it('同じ月の中でも14日以上なら月々は免除、1か月以下なので賞与は免除されない', () => {
    const p = planChildcare({ ...base, bornByEmployee: false, startDate: '2027-04-05', endDate: '2027-04-18' });
    expect(p.exemptMonths).toEqual(['2027-04']);
    expect(p.bonusExempt).toBe(false);
  });
  it('延長の区切りと3歳の上限', () => {
    expect(childcareLimits('2027-03-10').map(l => l.until)).toEqual(['2028-03-09', '2028-09-09', '2029-03-09', '2030-03-09']);
    expect(planChildcare({ ...base, startDate: '2027-05-06', endDate: '2028-09-09' }).stage).toBe('1歳6か月まで（延長）');
    expect(planChildcare({ ...base, startDate: '2027-05-06', endDate: '2030-03-10' }).errors).toHaveLength(1);
  });
});

describe('judgeLeaveEvent', () => {
  const maternity: LeaveFacts = {
    kind: 'maternity', start: '2027-01-28', plannedEnd: '2027-05-05', expectedBirthDate: '2027-03-10', actualBirthDate: null,
    multiple: false, childBirthDate: null, filedWithBirth: false,
  };
  it('出産が予定日より遅れたら変更届。産後は実際の出産日から56日', () => {
    const r = judgeLeaveEvent(maternity, { type: 'birth', date: '2027-03-15' });
    expect(r).toMatchObject({ filing: 'change', start: '2027-01-28', end: '2027-05-10', errors: [] });
  });
  it('予定日どおりの出産は届出が要らない', () => {
    expect(judgeLeaveEvent(maternity, { type: 'birth', date: '2027-03-10' }).filing).toBeNull();
  });
  it('出産後に申出書を出していれば、出産日の記録で届出は要らない', () => {
    expect(judgeLeaveEvent({ ...maternity, filedWithBirth: true }, { type: 'birth', date: '2027-03-15' }).filing).toBeNull();
  });
  it('予定より早く産休を終えたら終了届。産後6週間は休む', () => {
    const born = { ...maternity, actualBirthDate: '2027-03-10' };
    expect(judgeLeaveEvent(born, { type: 'end', date: '2027-04-25' })).toMatchObject({ filing: 'end', end: '2027-04-25', ended: true, errors: [] });
    expect(judgeLeaveEvent(born, { type: 'end', date: '2027-04-20' }).errors).toHaveLength(1);
    expect(judgeLeaveEvent(born, { type: 'end', date: '2027-05-05' })).toMatchObject({ filing: null, ended: true, errors: [] });
    expect(judgeLeaveEvent(maternity, { type: 'end', date: '2027-05-05' }).errors).toHaveLength(1);
  });
  const childcare: LeaveFacts = {
    kind: 'childcare', start: '2027-05-06', plannedEnd: '2028-03-09', expectedBirthDate: null, actualBirthDate: null,
    multiple: false, childBirthDate: '2027-03-10', filedWithBirth: false,
  };
  it('育休の延長は申出書（延長）、早く終えたら終了届', () => {
    expect(judgeLeaveEvent(childcare, { type: 'extend', date: '2028-09-09' })).toMatchObject({ filing: 'extend', end: '2028-09-09', errors: [] });
    expect(judgeLeaveEvent(childcare, { type: 'extend', date: '2028-03-01' }).errors).toHaveLength(1);
    expect(judgeLeaveEvent(childcare, { type: 'end', date: '2027-12-31' })).toMatchObject({ filing: 'end', end: '2027-12-31', ended: true });
    expect(judgeLeaveEvent(childcare, { type: 'end', date: '2028-03-09' }).filing).toBeNull();
    expect(judgeLeaveEvent(childcare, { type: 'end', date: '2028-03-10' }).errors).toHaveLength(1);
  });
});

describe('returnMonth', () => {
  it('休業の最終日の翌日が属する月', () => {
    expect(returnMonth('2027-05-05')).toBe('2027-05');
    expect(returnMonth('2028-03-31')).toBe('2028-04');
  });
});
