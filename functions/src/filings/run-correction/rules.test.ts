import {
  applyPersonPatch, flattenPerson, isSubmittedRunFiling, personBlockers, runCorrectionBlocker, runCorrectionErrors, runCorrectionsOf, runCorrectionSummary,
} from './rules';

const santeiPerson = (id: string, name: string) => ({
  employeeId: id, 被保険者整理番号: '12', 被保険者氏名: name, 生年月日: '1990-01-15', 適用年月: '2026-09',
  従前の標準報酬月額_健康保険: 300000, 従前の標準報酬月額_厚生年金: 300000, 従前の改定月: '2025-09',
  months: [4, 5, 6].map(月 => ({ 月, 支払基礎日数: 31, 通貨: 300000, 現物: 0, 合計: 300000 })),
  総計: 900000, 平均額: 300000, 修正平均額: null,
  決定_健康保険等級: 22, 決定_健康保険標準報酬月額: 300000, 決定_厚生年金等級: 19, 決定_厚生年金標準報酬月額: 300000,
  備考: '', 備考区分: [], 備考その他: '',
});
const bonusPerson = (id: string, name: string) => ({
  employeeId: id, 被保険者整理番号: '3', 被保険者氏名: name, 生年月日: '1985-05-01', 賞与支払年月日: '2026-12-10',
  賞与額_通貨: 500500, 賞与額_現物: 0, 賞与額_合計: 500500, 標準賞与額: 500000, 備考区分: [], 初回支払日: null,
});
const submitted = { status: 'submitted', submission: { method: 'mock', date: '2026-07-05', acceptanceNumber: 'MOCK-1' }, mock: { status: 'completed' } };

describe('runCorrectionBlocker', () => {
  it('提出済みの届出からだけ作れる', () => {
    expect(runCorrectionBlocker('santei', { ...submitted, filingType: 'remunerationMonthlyAlgorithm' })).toBeNull();
    expect(runCorrectionBlocker('santei', { status: 'approved', filingType: 'remunerationMonthlyAlgorithm' })).toMatch('まだ提出していない');
    expect(runCorrectionBlocker('bonus', { status: 'paper', filingType: 'bonusPayment', paper: { status: 'submitted', submittedDate: '2026-12-12' } })).toBeNull();
  });
  it('訂正届そのもの・不支給報告書・取り消した届出からは作れない', () => {
    expect(runCorrectionBlocker('santei', { ...submitted, filingType: 'correction' })).toMatch('さらに訂正');
    expect(runCorrectionBlocker('bonus', { ...submitted, filingType: 'bonusNonPayment' })).toMatch('不支給');
    expect(runCorrectionBlocker('bonus', { status: 'cancelled', filingType: 'bonusPayment' })).toMatch('取り消し済み');
  });
  it('旧来の status と submission だけの届出も提出済みと読む', () => {
    expect(isSubmittedRunFiling('santei', { status: 'submitted', submission: { method: 'paper', date: '2026-07-05' } })).toBe(true);
  });
});

describe('personBlockers', () => {
  const original = { persons: [santeiPerson('e1', '山田 太郎'), santeiPerson('e2', '佐藤 花子')], cancelledEmployeeIds: ['e2'] };
  it('元の届出にいない人・取消届を出した人・作りかけに載っている人は載せない', () => {
    const siblings = [{ filingType: 'correction', status: 'draft', employeeIds: ['e1'] }];
    expect(personBlockers({ kind: 'correction', employeeIds: ['e1', 'e2', 'x'], original, siblings })).toEqual([
      '山田 太郎：作りかけの訂正届に載っています', '佐藤 花子：取消届を提出済みです', 'x：元の届出に載っていません',
    ]);
  });
  it('提出し終えた訂正届・取り消した訂正届・別の種類の作りかけは妨げない', () => {
    const siblings = [
      { filingType: 'correction', status: 'submitted', employeeIds: ['e1'], appliedToOriginal: true },
      { filingType: 'correction', status: 'cancelled', employeeIds: ['e1'] },
      { filingType: 'cancellation', status: 'draft', employeeIds: ['e1'] },
    ];
    expect(personBlockers({ kind: 'correction', employeeIds: ['e1'], original, siblings })).toEqual([]);
  });
});

describe('applyPersonPatch と runCorrectionsOf', () => {
  it('算定基礎届：月の報酬を直すと月の合計を計算し直し、訂正箇所に出る', () => {
    const p = santeiPerson('e1', '山田 太郎');
    expect(flattenPerson('santei', p)['5月_通貨']).toBe(300000);
    const { person, rejected } = applyPersonPatch('santei', p, { '5月_通貨': '320,000', '5月_現物': 1000, 平均額: '307000', 決定_健康保険等級: 22 });
    expect(rejected).toEqual([]);
    expect(person.months[1]).toMatchObject({ 通貨: 320000, 現物: 1000, 合計: 321000 });
    expect(p.months[1].通貨).toBe(300000);
    expect(runCorrectionsOf('santei', [p], [person])).toEqual([
      { employeeId: 'e1', field: '山田 太郎：5月_通貨', before: '300000', after: '320000' },
      { employeeId: 'e1', field: '山田 太郎：5月_現物', before: '0', after: '1000' },
      { employeeId: 'e1', field: '山田 太郎：平均額', before: '300000', after: '307000' },
      { employeeId: 'e1', field: '山田 太郎：5月_合計', before: '300000', after: '321000' },
    ]);
  });
  it('賞与支払届：額を直すと合計と標準賞与額（千円未満切り捨て）を計算し直す', () => {
    const p = bonusPerson('e1', '山田 太郎');
    const { person } = applyPersonPatch('bonus', p, { 賞与額_通貨: 612345 });
    expect(person).toMatchObject({ 賞与額_合計: 612345, 標準賞与額: 612000 });
    expect(runCorrectionsOf('bonus', [p], [person]).map(r => r.field)).toEqual(['山田 太郎：賞与額_通貨', '山田 太郎：賞与額_合計', '山田 太郎：標準賞与額']);
  });
  it('直せない項目・数字でない値は断る', () => {
    const { rejected } = applyPersonPatch('bonus', bonusPerson('e1', 'a'), { employeeId: 'x', 備考区分: '1', 賞与額_通貨: 'abc', 標準賞与額: 1 });
    expect(rejected).toEqual(['employeeId', '備考区分', '賞与額_通貨', '標準賞与額']);
    expect(applyPersonPatch('santei', santeiPerson('e1', 'a'), { '7月_通貨': 1 }).rejected).toEqual(['7月_通貨']);
  });
});

describe('runCorrectionErrors と runCorrectionSummary', () => {
  it('理由・訂正箇所・対象の人がなければ送れない', () => {
    expect(runCorrectionErrors({ filingType: 'correction', reason: ' ', corrections: [], persons: [] })).toEqual([
      '訂正の理由がありません', '訂正箇所がありません（元の届出から直した項目がありません）', '対象の人がいません',
    ]);
    expect(runCorrectionErrors({ filingType: 'cancellation', reason: '誤って載せた', corrections: [], persons: [{}] })).toEqual([]);
  });
  it('一覧の情報', () => {
    expect(runCorrectionSummary({ filingType: 'cancellation', originalFilingId: 'f1', originalNumber: 1, reason: 'r', corrections: [] }))
      .toMatchObject({ kind: 'cancellation', originalFilingId: 'f1', originalNumber: 1, reason: 'r', correctionCount: 0 });
    expect(runCorrectionSummary({ filingType: 'bonusPayment', cancelledEmployeeIds: ['e1'] })).toMatchObject({ kind: null, reason: null, cancelledEmployeeIds: ['e1'] });
  });
});
