import { collectionPlan, collectionStatus, diffReasons, parseSalaryCsv, premiumMonthFor, remunerationWarning, splitCsvLine } from './rules';

const facts = { employee: 15_000, employer: 15_000, healthGrade: 22, pensionGrade: 19, exempted: false, longTermCare: false };

describe('毎月の処理：何月分と何月控除', () => {
  it('翌月控除は前月分、当月控除は当月分の保険料を控除する', () => {
    expect(premiumMonthFor('2026-11', 'previous')).toBe('2026-10');
    expect(premiumMonthFor('2026-01', 'previous')).toBe('2025-12');
    expect(premiumMonthFor('2026-11', 'current')).toBe('2026-11');
  });
});

describe('毎月の処理：前月差額の理由', () => {
  it('前月がなければ入社などとして示す', () => {
    expect(diffReasons(facts, null)[0]).toContain('前月の保険料がありません');
  });
  it('等級・介護・免除の変化を理由にする', () => {
    const r = diffReasons({ ...facts, healthGrade: 23, longTermCare: true }, facts);
    expect(r).toHaveLength(2);
    expect(r[0]).toContain('健保22→23');
    expect(r[1]).toContain('介護保険の開始');
    expect(diffReasons({ ...facts, exempted: true, employee: 0, employer: 0 }, facts)).toEqual(['産休・育休の免除の開始']);
  });
  it('等級などが同じで金額だけ違えば料率の変更、同じなら理由なし', () => {
    expect(diffReasons({ ...facts, employee: 15_100 }, facts)).toEqual(['料率の変更']);
    expect(diffReasons(facts, facts)).toEqual([]);
  });
});

describe('毎月の処理：異常値と徴収', () => {
  it('給与が標準報酬月額から25%以上離れたら注意を出す', () => {
    expect(remunerationWarning(380_000, 300_000)).toContain('随時改定');
    expect(remunerationWarning(360_000, 300_000)).toBeNull();
    expect(remunerationWarning(0, 300_000)).toBeNull();
  });
  it('無給・給与なし・給与が足りないときは別途入金にする', () => {
    expect(collectionPlan(15_000, { total: 300_000, noPay: false })).toBe('payroll');
    expect(collectionPlan(15_000, { total: 0, noPay: true })).toBe('transfer');
    expect(collectionPlan(15_000, null)).toBe('transfer');
    expect(collectionPlan(15_000, { total: 10_000, noPay: false })).toBe('transfer');
    expect(collectionPlan(0, null)).toBe('none');
  });
  it('徴収の状態：未徴収・一部・完了・過徴収', () => {
    expect(collectionStatus(15_000, null)).toBe('unpaid');
    expect(collectionStatus(15_000, 5_000)).toBe('partial');
    expect(collectionStatus(15_000, 15_000)).toBe('done');
    expect(collectionStatus(15_000, 20_000)).toBe('over');
    expect(collectionStatus(0, null)).toBe('none');
  });
});

describe('毎月の処理：給与CSV', () => {
  const header = '社員番号,氏名,支払基礎日数,基本給,固定:通勤手当,非固定:残業手当,現物給与,遡及差額,遡及開始月,遡及終了月,無給';

  it('囲み文字と桁区切りを読む', () => {
    expect(splitCsvLine('a,"1,000","x""y"')).toEqual(['a', '1,000', 'x"y']);
  });

  it('手当の列を固定・非固定に分け、無給の人は金額なしで読む', () => {
    const { rows, errors } = parseSalaryCsv(`﻿${header}\r\nT-1,山田,20,"300,000",15000,20000,0,,,,\r\nT-2,田中,,0,0,0,0,,,,1\r\n`);
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ employeeNumber: 'T-1', paymentBasisDays: 20, baseSalary: 300_000, fixedAllowances: { 通勤手当: 15_000 }, variableAllowances: { 残業手当: 20_000 }, noPay: false });
    expect(rows[1]).toMatchObject({ employeeNumber: 'T-2', paymentBasisDays: 0, noPay: true });
  });

  it('誤りのある行を行番号つきで返し、正しい行は残す', () => {
    const csv = [header, 'T-1,,20,300000,0,0,0,,,,', 'T-1,,20,300000,0,0,0,,,,', 'T-3,,40,300000,0,0,0,,,,', 'T-4,,20,abc,0,0,0,,,,', 'T-5,,20,0,0,0,0,,,,', 'T-6,,20,300000,0,0,0,,,,1', 'T-7,,20,300000,0,10000,0,10000,2026-04,,'].join('\n');
    const { rows, errors } = parseSalaryCsv(csv);
    expect(rows.map(r => r.employeeNumber)).toEqual(['T-1', 'T-7']);
    expect(rows[1].retroactivePay).toEqual({ amount: 10_000, fromMonth: '2026-04', toMonth: '2026-04' });
    expect(errors.map(e => [e.line, e.message.slice(0, 8)])).toEqual([
      [3, '2行目と社員番号'], [4, '支払基礎日数は0'], [5, '基本給は0以上の'], [6, '金額がありません'], [7, '無給の人に金額が'],
    ]);
  });

  it('見出しがない・知らない列があるときはファイル全体を止める', () => {
    expect(parseSalaryCsv('T-1,20,300000').errors[0].message).toContain('見出し');
    expect(parseSalaryCsv('社員番号,基本給,住宅手当\nT-1,1,1').errors[0].message).toContain('住宅手当');
  });
});

jest.mock('../config', () => ({ db: {} }));
import { assertRateUnit } from '../utils/insurance-rate';

describe('料率の単位の確認（‰で登録する）', () => {
  it('‰の料率は通し、小数や％で登録された料率は止める', () => {
    expect(() => assertRateUnit({ insuranceType: 'health', appliedFrom: '2026-03', employeeRate: 49.25, employerRate: 49.25, totalRate: 98.5 })).not.toThrow();
    expect(() => assertRateUnit({ insuranceType: 'childSupport', appliedFrom: '2026-04', employeeRate: 0, employerRate: 3.6, totalRate: 3.6 })).not.toThrow();
    expect(() => assertRateUnit({ insuranceType: 'health', appliedFrom: '2024-04', employeeRate: 0.0499, employerRate: 0.0499, totalRate: 0.0998 })).toThrow('料率の単位が正しくありません（健康保険・2024-04から');
  });
});
