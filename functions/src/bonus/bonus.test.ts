import { splitCsvLine } from '../monthly/rules';
import {
  bonusCaps, bonusFilingDeadline, bonusFilingPerson, bonusTarget, capWarnings, commonPaymentDate, earlierMonthsInFiscalYear, fiscalYearOf,
  parseBonusCsv, paymentCountWarning, paymentErrors, summarizePayments,
} from './bonus-calc';

describe('年度', () => {
  it('4月始まりで数える', () => {
    expect(fiscalYearOf('2026-04')).toBe(2026);
    expect(fiscalYearOf('2027-03')).toBe(2026);
    expect(earlierMonthsInFiscalYear('2026-04')).toEqual([]);
    expect(earlierMonthsInFiscalYear('2026-07')).toEqual(['2026-04', '2026-05', '2026-06']);
    expect(earlierMonthsInFiscalYear('2027-02')).toHaveLength(10);
    expect(earlierMonthsInFiscalYear('2027-02').at(-1)).toBe('2027-01');
  });
});

describe('同月合算', () => {
  it('合算額の千円未満を切り捨て、初回の支給日を使う', () => {
    const s = summarizePayments([{ date: '2026-12-25', cash: 300_500, inKind: 0 }, { date: '2026-12-10', cash: 500_700, inKind: 10_000 }]);
    expect(s.total).toBe(811_200);
    expect(s.standard).toBe(811_000);
    expect(s.firstPaymentDate).toBe('2026-12-10');
    expect(s.combined).toBe(true);
  });
  it('別の月の日付・0円・同じ日の2回は誤り', () => {
    expect(paymentErrors('2026-12', [{ date: '2026-11-30', cash: 1, inKind: 0 }])[0]).toContain('2026-12の日付ではありません');
    expect(paymentErrors('2026-12', [{ date: '2026-12-10', cash: 0, inKind: 0 }])[0]).toContain('0円');
    expect(paymentErrors('2026-12', [{ date: '2026-12-10', cash: 1, inKind: 0 }, { date: '2026-12-10', cash: 2, inKind: 0 }])).toHaveLength(1);
  });
});

describe('上限', () => {
  it('健保は年度累計573万円、厚年は月150万円', () => {
    const c = bonusCaps(2_000_000, 4_500_000);
    expect(c.healthCapped).toBe(1_230_000);
    expect(c.pensionCapped).toBe(1_500_000);
    expect(c.healthOverCap).toBe(true);
    expect(c.pensionOverCap).toBe(true);
    expect(capWarnings(c)).toHaveLength(2);
  });
  it('すでに上限に達していれば健保は0円', () => {
    expect(bonusCaps(500_000, 5_730_000).healthCapped).toBe(0);
  });
  it('ちょうど573万円は超えていない。8割を超えたら近い', () => {
    const exact = bonusCaps(1_000_000, 4_730_000);
    expect(exact.healthCapped).toBe(1_000_000);
    expect(exact.healthOverCap).toBe(false);
    expect(exact.nearHealthCap).toBe(true);
    expect(capWarnings(exact)[0]).toContain('近づいて');
    expect(bonusCaps(1_000_000, 3_000_000).nearHealthCap).toBe(false);
    expect(capWarnings(bonusCaps(1_500_000, 0))).toEqual([]);
  });
});

describe('保険料と届出の要否', () => {
  const base = { yearMonth: '2026-12', acquisitionDate: '2020-04-01', lossDate: null, enrolled: true };
  it('在籍中は保険料も届出も', () => {
    expect(bonusTarget({ ...base, firstPaymentDate: '2026-12-10' }).target).toBe('charged');
  });
  it('喪失月で喪失日より前の支給は届出だけ', () => {
    expect(bonusTarget({ ...base, lossDate: '2026-12-21', firstPaymentDate: '2026-12-10' }).target).toBe('lossMonth');
  });
  it('月末退職（喪失日が翌月1日）は保険料がかかる', () => {
    expect(bonusTarget({ ...base, lossDate: '2027-01-01', firstPaymentDate: '2026-12-10' }).target).toBe('charged');
  });
  it('喪失日以後の支給・適用外・取得前は届出も要らない', () => {
    expect(bonusTarget({ ...base, lossDate: '2026-12-05', firstPaymentDate: '2026-12-10' }).target).toBe('excluded');
    expect(bonusTarget({ ...base, enrolled: false, firstPaymentDate: '2026-12-10' }).target).toBe('excluded');
    expect(bonusTarget({ ...base, acquisitionDate: '2026-12-15', firstPaymentDate: '2026-12-10' }).target).toBe('excluded');
  });
  it('同月得喪は保険料がかかる', () => {
    expect(bonusTarget({ ...base, acquisitionDate: '2026-12-01', lossDate: '2026-12-20', firstPaymentDate: '2026-12-10' }).target).toBe('charged');
  });
});

describe('年4回以上', () => {
  it('年度で4回目から警告', () => {
    expect(paymentCountWarning(2, 1)).toBeNull();
    expect(paymentCountWarning(3, 1)).toContain('4回目');
    expect(paymentCountWarning(2, 2)).toContain('4回目');
  });
});

describe('届出', () => {
  it('期限は支給日から5日', () => {
    expect(bonusFilingDeadline('2026-12-28')).toBe('2027-01-02');
  });
  it('同月合算と70歳以上の備考', () => {
    const p = bonusFilingPerson({
      employeeId: 'e1', insuredPersonNumber: '12', name: '山田 一郎', birthDate: '1950-01-01', age70: true,
      payments: [{ date: '2026-12-25', cash: 100_000, inKind: 0 }, { date: '2026-12-05', cash: 200_000, inKind: 5_500 }],
    });
    expect(p.賞与支払年月日).toBe('2026-12-05');
    expect(p.賞与額_合計).toBe(305_500);
    expect(p.標準賞与額).toBe(305_000);
    expect(p.備考区分).toEqual([1, 3]);
    expect(p.初回支払日).toBe(5);
  });
  it('共通の支払日はいちばん多い日', () => {
    expect(commonPaymentDate(['2026-12-10', '2026-12-25', '2026-12-25'])).toBe('2026-12-25');
    expect(commonPaymentDate([])).toBeNull();
  });
});

describe('CSV', () => {
  it('同じ人の複数行は同月の別の支給', () => {
    const r = parseBonusCsv('社員番号,支給日,賞与額,現物\nA1,2026-12-10,"500,000",0\nA1,2026/12/25,100000,\nA2,2026-12-10,300000,1000', '2026-12', splitCsvLine);
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0].payments).toEqual([{ date: '2026-12-10', cash: 500_000, inKind: 0 }, { date: '2026-12-25', cash: 100_000, inKind: 0 }]);
  });
  it('誤りのある人はすべての行を取り込まない', () => {
    const r = parseBonusCsv('社員番号,支給日,賞与額\nA1,2026-12-10,500000\nA1,2026-11-25,100000\nA2,2026-12-10,abc', '2026-12', splitCsvLine);
    expect(r.rows).toEqual([]);
    expect(r.errors.map(e => e.line)).toEqual([2, 3, 4]);
  });
  it('見出しがない・知らない列は全体を止める', () => {
    expect(parseBonusCsv('A1,2026-12-10,1', '2026-12', splitCsvLine).errors[0].line).toBe(1);
    expect(parseBonusCsv('社員番号,支給日,賞与額,手当\n', '2026-12', splitCsvLine).errors[0].message).toContain('手当');
  });
});

import { bonusProgress, bonusStepState } from './progress';
import type { BonusRow } from './service';

describe('進み具合', () => {
  const bonus = { payments: [], cash: 1, inKind: 0, total: 1, standard: 0, firstPaymentDate: '2026-12-10', combined: false, confirmed: false, pending: false, version: 1 };
  const row = (o: Partial<BonusRow> = {}): BonusRow => ({
    employeeId: 'e', employeeNumber: '1', name: 'a', inPeriod: true, bonus, target: 'charged', targetReason: '', caps: null, premium: null, stale: false,
    age70: false, issues: [], warnings: [], hold: null, rejected: { bonus: null, premium: null }, filingId: null, ...o,
  });
  const base = { filings: [], canApprove: true, uid: 'me', reviews: { bonus: null, premium: null }, scheduled: false, monthEnded: true, nonPayment: null };
  it('ステップの状態', () => {
    expect(bonusStepState('entry', row({ bonus: null }))).toBeNull();
    expect(bonusStepState('review', row())?.label).toBe('依頼前');
    expect(bonusStepState('premium', row())).toBeNull();
    const approved = { ...bonus, confirmed: true };
    expect(bonusStepState('premium', row({ bonus: approved }))?.label).toBe('未計算');
    expect(bonusStepState('premium', row({ bonus: approved, target: 'excluded' }))).toBeNull();
    const premium = { employee: 0, employer: 0, healthCapped: 0, pensionCapped: 0, exempted: false, confirmed: true, pending: false, version: 2 };
    expect(bonusStepState('filing', row({ bonus: approved, premium }))?.label).toBe('届出 未作成');
  });
  it('次にやること', () => {
    expect(bonusProgress({ ...base, rows: [row()] })?.next).toBe('賞与額の承認を依頼する');
    expect(bonusProgress({ ...base, rows: [row({ bonus: { ...bonus, pending: true } })] })?.tone).toBe('yours');
    expect(bonusProgress({ ...base, reviews: { bonus: { mine: true }, premium: null }, rows: [row({ bonus: { ...bonus, pending: true } })] })?.tone).toBe('waiting');
  });
  it('支給予定月に賞与がなければ不支給報告書を知らせる', () => {
    const empty = [row({ bonus: null })];
    expect(bonusProgress({ ...base, rows: empty, scheduled: true })?.next).toContain('不支給報告書');
    expect(bonusProgress({ ...base, rows: empty, scheduled: true, nonPayment: { reportedOn: '2026-10-01' } })).toBeNull();
    expect(bonusProgress({ ...base, rows: empty, scheduled: true, monthEnded: false })).toBeNull();
    expect(bonusProgress({ ...base, rows: empty })).toBeNull();
  });
});
