import { resignationFacts, settlementMonths, settlementPlan } from './rules';

const base = {
  reason: 'resignation' as const, birthDate: '1990-05-10', acquisitionDate: '2020-04-01',
  enrolled: { health: true, pension: true }, isForeign: false,
};

describe('resignationFacts', () => {
  it('月の途中の退職：喪失日は翌日、保険料は前月分まで、期限は喪失日から5日', () => {
    const f = resignationFacts({ ...base, resignationDate: '2026-11-15' });
    expect(f.lossDate).toBe('2026-11-16');
    expect(f.lastChargedMonth).toBe('2026-10');
    expect(f.filingDeadline).toBe('2026-11-21');
    expect(f.lossCause).toBe('退職等');
  });

  it('月末の退職：喪失日は翌月1日、退職した月の保険料もかかる', () => {
    const f = resignationFacts({ ...base, resignationDate: '2026-11-30' });
    expect(f.lossDate).toBe('2026-12-01');
    expect(f.lastChargedMonth).toBe('2026-11');
    expect(f.notes.some(n => n.includes('月末の退職'))).toBe(true);
  });

  it('同月得喪：入社した月の保険料が1か月分かかる', () => {
    const f = resignationFacts({ ...base, acquisitionDate: '2026-11-01', resignationDate: '2026-11-20' });
    expect(f.sameMonth).toBe(true);
    expect(f.lastChargedMonth).toBe('2026-11');
  });

  it('入社月の末日に退職：同月得喪ではなく、入社月の分がかかる', () => {
    const f = resignationFacts({ ...base, acquisitionDate: '2026-11-10', resignationDate: '2026-11-30' });
    expect(f.sameMonth).toBe(false);
    expect(f.lastChargedMonth).toBe('2026-11');
  });

  it('閲覧専用は喪失日から、退職日から3か月で閲覧できなくなる', () => {
    expect(resignationFacts({ ...base, resignationDate: '2026-03-31' }).account)
      .toEqual({ viewOnlyFrom: '2026-04-01', accessUntil: '2026-06-30', loginStopsFrom: '2026-07-01' });
    expect(resignationFacts({ ...base, resignationDate: '2026-11-15' }).account.accessUntil).toBe('2027-02-15');
  });

  it('70歳以上：厚生年金は喪失しないが、70歳以上被用者の不該当を届け出る', () => {
    const f = resignationFacts({ ...base, birthDate: '1955-01-10', resignationDate: '2026-11-30', enrolled: { health: true, pension: false } });
    expect(f.lost).toEqual({ health: true, pension: false });
    expect(f.over70Worker).toBe(true);
    expect(f.needsFiling).toBe(true);
  });

  it('75歳以上：健康保険・厚生年金とも加入していないが、届出は要る。保険料はかからない', () => {
    const f = resignationFacts({ ...base, birthDate: '1950-01-10', resignationDate: '2026-11-30', enrolled: { health: false, pension: false } });
    expect(f.lost).toEqual({ health: false, pension: false });
    expect(f.needsFiling).toBe(true);
    expect(f.lastChargedMonth).toBeNull();
  });

  it('社会保険に加入していない人は届出も保険料もない', () => {
    const f = resignationFacts({ ...base, acquisitionDate: null, enrolled: { health: false, pension: false }, resignationDate: '2026-11-30' });
    expect(f.needsFiling).toBe(false);
    expect(f.filingDeadline).toBeNull();
    expect(f.lastChargedMonth).toBeNull();
  });

  it('外国人で厚生年金を喪失する人には脱退一時金を案内する', () => {
    expect(resignationFacts({ ...base, isForeign: true, resignationDate: '2026-11-30' }).foreignNotice).toContain('脱退一時金');
    expect(resignationFacts({ ...base, resignationDate: '2026-11-30' }).foreignNotice).toBeNull();
  });
});

describe('settlementMonths', () => {
  it('最後の月とその前の2か月。資格取得月より前は含めない', () => {
    expect(settlementMonths('2020-04-01', '2026-11')).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(settlementMonths('2026-10-15', '2026-11')).toEqual(['2026-10', '2026-11']);
  });
});

describe('settlementPlan', () => {
  const m = (month: string, due: number, collected = 0) => ({ month, due, dueSource: 'confirmed' as const, collected });

  it('翌月控除・月末退職で最後の給与が退職月：退職月の分も最後の給与からまとめて控除', () => {
    const r = settlementPlan([m('2026-10', 30000, 30000), m('2026-11', 30000)], 'previous', '2026-11');
    expect(r.rows.map(x => x.plan)).toEqual(['collected', 'final']);
    expect(r.rows[1].payMonth).toBe('2026-11');
  });

  it('翌月控除・退職後の給与がない：最後の給与より後の月の分は別途入金', () => {
    const r = settlementPlan([m('2026-11', 30000)], 'previous', '2026-10');
    expect(r.rows[0].plan).toBe('transfer');
    expect(r.totals.transfer).toBe(30000);
  });

  it('翌月控除・退職後に給与がある：いつもどおり翌月の給与から控除', () => {
    const r = settlementPlan([m('2026-10', 30000), m('2026-11', 30000)], 'previous', '2026-12');
    expect(r.rows.map(x => [x.plan, x.payMonth])).toEqual([['payroll', '2026-11'], ['payroll', '2026-12']]);
    expect(r.totals.payroll).toBe(60000);
  });

  it('当月控除：その月の給与から控除', () => {
    const r = settlementPlan([m('2026-11', 30000)], 'current', '2026-11');
    expect(r.rows[0]).toMatchObject({ plan: 'payroll', payMonth: '2026-11' });
  });

  it('取りすぎは返金、0円の月は対象外、見込みの額を知らせる', () => {
    const r = settlementPlan([m('2026-09', 0), m('2026-10', 30000, 31000), { month: '2026-11', due: 30000, dueSource: 'estimate', collected: 0 }], 'previous', '2026-12');
    expect(r.rows.map(x => x.plan)).toEqual(['none', 'over', 'payroll']);
    expect(r.totals.over).toBe(1000);
    expect(r.hasEstimate).toBe(true);
  });

  it('等級がない月は計算できないとして返す', () => {
    const r = settlementPlan([{ month: '2026-11', due: 0, dueSource: 'noGrade', collected: 0 }], 'previous', '2026-12');
    expect(r.rows[0].plan).toBe('unknown');
    expect(r.unknownMonths).toEqual(['2026-11']);
  });

  it('退職後に支給する給与がない：最後の給与からまとめて引けず、別途入金になる', () => {
    const r = settlementPlan([m('2026-10', 30000), m('2026-11', 30000)], 'previous', '2026-11', false);
    expect(r.rows.map(x => [x.plan, x.payMonth])).toEqual([['payroll', '2026-11'], ['transfer', null]]);
    expect(r.totals.transfer).toBe(30000);
  });
});
