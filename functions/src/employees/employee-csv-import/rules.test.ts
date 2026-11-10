import { CsvContext, CsvExisting, employeeCsvTemplate, normalizeDate, planEmployeeCsv } from './rules';

// 検査用数字の合う個人番号（check-digit.test.ts と同じ作り方）
import { myNumberCheckDigit } from '../../utils/check-digit';
const myNo = (first11: string) => `${first11}${myNumberCheckDigit(first11)}`;
const A = myNo('12345678901');
const B = myNo('23456789012');

const HEADER = '社員番号,姓,名,姓カナ,名カナ,生年月日,性別,事業所,部署,入社日,郵便番号,電話番号,個人番号';

const existing = (over: Partial<CsvExisting> & { values?: CsvExisting['values'] } = {}): CsvExisting => ({
  id: 'emp-1', employeeNumber: '1', officeId: 'hq', departmentId: null, version: 3, isActive: true, hasMyNumber: false,
  ...over,
  values: { lastName: '山田', firstName: '太郎', lastNameKana: 'ヤマダ', firstNameKana: 'タロウ', birthDate: '1990-04-01', gender: 'male', hireDate: '2020-04-01', phone: null, ...over.values },
});

const ctx = (over: Partial<CsvContext> = {}): CsvContext => ({
  offices: [{ id: 'hq', name: '本社', officeNumber: '01-イロハ' }, { id: 'osaka', name: '大阪支社' }, { id: 'old', name: '旧事業所', abolished: true }],
  departments: [{ id: 'dev', officeId: 'hq', name: '開発部', isActive: true }, { id: 'gone', officeId: 'hq', name: '旧部署', isActive: false }],
  existing: [existing()],
  allowedOfficeIds: null,
  ...over,
});

const csv = (...rows: string[]) => [HEADER, ...rows].join('\r\n');

describe('normalizeDate', () => {
  it('ハイフン・スラッシュ・年月日を受け、実在しない日付は断る', () => {
    expect(normalizeDate('2026/4/1')).toBe('2026-04-01');
    expect(normalizeDate('2026年4月1日')).toBe('2026-04-01');
    expect(normalizeDate('２０２６-０４-０１')).toBe('2026-04-01');
    expect(normalizeDate('2026-02-30')).toBeNull();
    expect(normalizeDate('4/1/2026')).toBeNull();
  });
});

describe('planEmployeeCsv', () => {
  it('社員番号が台帳にない行は新規、ある行は変わる項目だけを更新にする（空欄は変えない）', () => {
    const plan = planEmployeeCsv(csv(
      '2,佐藤,花子,サトウ,ハナコ,1995/1/2,女,本社,開発部,2026-04-01,1000001,,',
      '1,山田,太郎,,,1990-04-01,男,本社,,,,03-1234-5678,',
    ), ctx());
    expect(plan.errors).toEqual([]);
    expect(plan.creates).toHaveLength(1);
    expect(plan.creates[0]).toMatchObject({ employeeNumber: '2', officeId: 'hq', departmentId: 'dev', fields: { gender: 'female', birthDate: '1995-01-02', postalCode: '100-0001' } });
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0]).toMatchObject({ employeeId: 'emp-1', expectedVersion: 3, fields: { phone: '03-1234-5678' } });
    expect(plan.updates[0].changes).toEqual([{ label: '電話番号', from: '（空欄）', to: '03-1234-5678' }]);
  });

  it('何も変わらない行は「変わらない」に数える', () => {
    const plan = planEmployeeCsv(csv('1,山田,太郎,ヤマダ,タロウ,1990-04-01,男,本社,,2020-04-01,,,'), ctx());
    expect(plan.unchanged).toEqual([{ line: 2, employeeNumber: '1', name: '山田 太郎' }]);
    expect(plan.updates).toHaveLength(0);
  });

  it('新規で必須の項目がない・日付や性別の形が違う行は、行番号つきの誤りにして取り込まない', () => {
    const plan = planEmployeeCsv(csv(
      '3,鈴木,,スズキ,イチロウ,1990-01-01,男,本社,,2026-04-01,,,',
      '4,高橋,次郎,タカハシ,ジロウ,1990-13-01,不明,本社,,2026-04-01,,,',
    ), ctx());
    expect(plan.creates).toHaveLength(0);
    expect(plan.errors.filter(e => e.line === 2).map(e => e.message).join()).toContain('名');
    const line3 = plan.errors.filter(e => e.line === 3).map(e => e.message).join();
    expect(line3).toContain('生年月日');
    expect(line3).toContain('性別');
  });

  it('入社日が生年月日より前の行は断る。更新で片方だけ書いた行は、台帳の値と比べる', () => {
    const plan = planEmployeeCsv(csv(
      '5,伊藤,三郎,イトウ,サブロウ,2000-05-05,男,本社,,1999-04-01,,,',
      '1,,,,,,,,,1986-11-01,,,',
      '1,,,,,2021-01-01,,,,,,,',
    ), ctx());
    expect(plan.creates).toHaveLength(0);
    expect(plan.updates).toHaveLength(0);
    expect(plan.errors.find(e => e.line === 2)?.message).toContain('入社日（1999-04-01）が生年月日（2000-05-05）より前');
    expect(plan.errors.find(e => e.line === 3)?.message).toContain('入社日（1986-11-01）が生年月日（1990-04-01）より前');
    expect(plan.errors.filter(e => e.line === 4).map(e => e.message).join()).toContain('入社日（2020-04-01）が生年月日（2021-01-01）より前');
  });

  it('ファイルの中の重複（社員番号・氏名＋生年月日・個人番号）は2行目以降を誤りにする', () => {
    const plan = planEmployeeCsv(csv(
      `5,伊藤,一,イトウ,ハジメ,1980-01-01,男,本社,,2026-04-01,,,${A}`,
      `5,伊藤,二,イトウ,ニ,1981-01-01,男,本社,,2026-04-01,,,`,
      `6,伊藤,一,イトウ,ハジメ,1980-01-01,男,本社,,2026-04-01,,,`,
      `7,加藤,三,カトウ,サン,1982-01-01,男,本社,,2026-04-01,,,${A}`,
    ), ctx());
    expect(plan.creates.map(r => r.employeeNumber)).toEqual(['5']);
    expect(plan.errors.find(e => e.line === 3)?.message).toContain('同じ社員番号');
    expect(plan.errors.find(e => e.line === 4)?.message).toContain('氏名と生年月日が同じ行');
    expect(plan.errors.find(e => e.line === 5)?.message).toContain('同じ個人番号');
  });

  it('台帳との重複：同じ氏名・生年月日の別の従業員、別の従業員の個人番号は断る。本人と同じ番号は変更なし', () => {
    const others = ctx({ myNumbers: new Map([['emp-1', A]]) });
    const plan = planEmployeeCsv(csv(
      `8,山田,太郎,ヤマダ,タロウ,1990-04-01,男,本社,,2026-04-01,,,`,
      `9,中村,四郎,ナカムラ,シロウ,1970-01-01,男,本社,,2026-04-01,,,${A}`,
    ), others);
    expect(plan.errors.find(e => e.line === 2)?.message).toContain('社員番号 1');
    expect(plan.errors.find(e => e.line === 3)?.message).toContain('別の従業員（社員番号 1）');
    const self = planEmployeeCsv(csv(`1,,,,,,,,,,,,${A}`), others);
    expect(self.unchanged.map(r => r.employeeNumber)).toEqual(['1']);
  });

  it('個人番号は値を変更の一覧に出さず、登録・変更だけを伝える', () => {
    const plan = planEmployeeCsv(csv(`1,,,,,,,,,,,,${B}`), ctx({ existing: [existing({ hasMyNumber: true })], myNumbers: new Map([['emp-1', A]]) }));
    expect(plan.updates[0].myNumber).toBe(B);
    expect(JSON.stringify(plan.updates[0].changes)).not.toContain(B);
    expect(plan.updates[0].changes[0]).toMatchObject({ label: '個人番号', to: '新しい番号（伏せています）' });
    const bad = planEmployeeCsv(csv('1,,,,,,,,,,,,123456789012'), ctx());
    expect(bad.errors[0].message).toContain('検査用数字');
  });

  it('事業所は名前か整理記号で探す。ない・廃止・異動になる行・担当外は断る。部署は事業所の中の使っている部署だけ', () => {
    const plan = planEmployeeCsv(csv(
      '10,木村,五郎,キムラ,ゴロウ,1990-01-01,男,01-イロハ,,2026-04-01,,,',
      '11,林,六郎,ハヤシ,ロクロウ,1990-01-02,男,名古屋,,2026-04-01,,,',
      '12,森,七郎,モリ,シチロウ,1990-01-03,男,旧事業所,,2026-04-01,,,',
      '1,,,,,,,大阪支社,,,,,',
      '13,池田,八郎,イケダ,ハチロウ,1990-01-04,男,本社,旧部署,2026-04-01,,,',
    ), ctx());
    expect(plan.creates.map(r => [r.employeeNumber, r.officeId])).toEqual([['10', 'hq']]);
    expect(plan.errors.find(e => e.line === 3)?.message).toContain('見つかりません');
    expect(plan.errors.find(e => e.line === 4)?.message).toContain('廃止');
    expect(plan.errors.find(e => e.line === 5)?.message).toContain('異動の手続き');
    expect(plan.errors.find(e => e.line === 6)?.message).toContain('使わない部署');

    const scoped = planEmployeeCsv(csv('14,山口,九郎,ヤマグチ,クロウ,1990-01-05,男,大阪支社,,2026-04-01,,,'), ctx({ allowedOfficeIds: ['hq'] }));
    expect(scoped.errors[0].message).toContain('担当事業所外');
  });

  it('Excel で先頭の 0 が消えた社員番号（0019 → 19）も、1人に決まれば台帳のその人として更新する', () => {
    const zero = ctx({ existing: [existing({ id: 'emp-19', employeeNumber: '0019' })] });
    const plan = planEmployeeCsv(csv('19,,,,,,,,,,,03-1234-5678,'), zero);
    expect(plan.errors).toEqual([]);
    expect(plan.updates[0]).toMatchObject({ employeeId: 'emp-19', employeeNumber: '0019' });
    // 0 を除くと2人に当たるときは決めない（新規として扱い、必須の項目が足りなければ誤り）
    const twins = ctx({ existing: [existing({ id: 'a', employeeNumber: '019' }), existing({ id: 'b', employeeNumber: '0019', values: { lastName: '別', firstName: '人', birthDate: '1980-01-01' } })] });
    expect(planEmployeeCsv(csv('19,,,,,,,,,,,03-1234-5678,'), twins).errors[0].message).toContain('新しく登録する');
    // 同じ人を 0019 と 19 で2回書いたら重複
    const dup = planEmployeeCsv(csv('0019,,,,,,,,,,,03-1234-5678,', '19,,,,,,,,,,,03-1234-5679,'), zero);
    expect(dup.errors[0]).toMatchObject({ line: 3, message: expect.stringContaining('同じ社員番号') });
  });

  it('退職した従業員は取込で直さない', () => {
    const plan = planEmployeeCsv(csv('1,,,,,,,,,,,03-1111-2222,'), ctx({ existing: [existing({ isActive: false })] }));
    expect(plan.errors[0].message).toContain('退職');
  });

  it('見出しがない・読めない列は全体を止める。CSV出力だけの列（退職日・在籍状況）は読み飛ばす', () => {
    expect(planEmployeeCsv('1,山田', ctx()).errors[0].message).toContain('見出し');
    expect(planEmployeeCsv('社員番号,基本給\r\n1,300000', ctx()).errors[0].message).toContain('基本給');
    const plan = planEmployeeCsv('社員番号,電話番号,退職日,在籍状況\r\n1,03-1234-5678,,在籍', ctx());
    expect(plan.errors).toEqual([]);
    expect(plan.updates).toHaveLength(1);
  });

  it('テンプレートは見出し（必須に *）と見本1行で、そのまま新規として読める', () => {
    const plan = planEmployeeCsv(employeeCsvTemplate(), ctx({ existing: [] }));
    expect(plan.errors).toEqual([]);
    expect(plan.creates[0]).toMatchObject({ employeeNumber: '1001', name: '山田 太郎', officeId: 'hq' });
  });
});
