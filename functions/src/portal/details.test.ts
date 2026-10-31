import { annualTotals, portalFilingStatus, withChanges } from './details';

const m = (yearMonth: string, total: number, extra: Partial<{ isExempted: boolean; longTermCare: number | null }> = {}) => ({
  yearMonth, standardRemuneration: 300000, health: 0, childSupport: 0, longTermCare: null, pension: 0, total, isExempted: false, ...extra,
});

describe('withChanges', () => {
  it('本人負担が変わった月に、等級・免除・介護・料率の理由を付ける', () => {
    const months = [m('2026-03', 40000), m('2026-04', 41000), m('2026-05', 41000), m('2026-06', 43000), m('2026-07', 0, { isExempted: true }), m('2026-08', 45000, { longTermCare: 2000 })];
    const grades = [
      { yearMonth: '2026-03', healthGrade: 22, pensionGrade: 19 }, { yearMonth: '2026-04', healthGrade: 22, pensionGrade: 19 },
      { yearMonth: '2026-05', healthGrade: 22, pensionGrade: 19 }, { yearMonth: '2026-06', healthGrade: 23, pensionGrade: 20 },
      { yearMonth: '2026-07', healthGrade: 23, pensionGrade: 20 }, { yearMonth: '2026-08', healthGrade: 23, pensionGrade: 20 },
    ];
    const r = withChanges(months, grades);
    expect(r.map(x => x.changeReason)).toEqual([null, '料率の改定', null, '等級の改定', '産休・育休の免除', '免除の終了']);
    expect(r[3].change).toBe(2000);
  });
});

describe('annualTotals', () => {
  it('年ごとに合計する（新しい年から）', () => {
    const r = annualTotals(withChanges([m('2025-12', 100), m('2026-01', 200), m('2026-02', 200)], []));
    expect(r).toEqual([{ year: '2026', total: 400, months: 2 }, { year: '2025', total: 100, months: 1 }]);
  });
});

describe('portalFilingStatus', () => {
  it('本人に見せる4つの状態にまとめる', () => {
    expect(portalFilingStatus({ workflowStatus: 'pending' })).toBe('申請中');
    expect(portalFilingStatus({ workflowStatus: 'approved' })).toBe('承認済み');
    expect(portalFilingStatus({ workflowStatus: 'approved', paper: { status: 'submitted' } })).toBe('提出済み');
    expect(portalFilingStatus({ workflowStatus: 'approved', paper: { status: 'accepted' } })).toBe('完了');
  });
});
