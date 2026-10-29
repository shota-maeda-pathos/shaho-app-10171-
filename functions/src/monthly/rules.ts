// 毎月の処理の判定（Firestore に触れない純粋関数）
import { addMonths } from '../insurance/calculator';

export type DeductionMethod = 'current' | 'previous';

/** 給与の支給月から、その給与で控除する保険料の月（何月分）を出す。翌月控除なら前月分 */
export function premiumMonthFor(payMonth: string, method: DeductionMethod): string {
  return method === 'previous' ? addMonths(payMonth, -1) : payMonth;
}

export interface PremiumFacts {
  employee: number;
  employer: number;
  healthGrade: number;
  pensionGrade: number;
  exempted: boolean;
  longTermCare: boolean;
}

/** 前月との差額の理由。差がなければ空 */
export function diffReasons(current: PremiumFacts, previous: PremiumFacts | null): string[] {
  if (!previous) return ['前月の保険料がありません（入社・加入の月など）'];
  const reasons: string[] = [];
  if (current.healthGrade !== previous.healthGrade || current.pensionGrade !== previous.pensionGrade) {
    reasons.push(`等級の変更（健保${previous.healthGrade}→${current.healthGrade}、厚年${previous.pensionGrade}→${current.pensionGrade}）`);
  }
  if (current.longTermCare !== previous.longTermCare) reasons.push(current.longTermCare ? '介護保険の開始（40歳到達）' : '介護保険の終了（65歳到達）');
  if (current.exempted !== previous.exempted) reasons.push(current.exempted ? '産休・育休の免除の開始' : '産休・育休の免除の終了');
  if (reasons.length === 0 && (current.employee !== previous.employee || current.employer !== previous.employer)) reasons.push('料率の変更');
  return reasons;
}

/** 給与と等級の開きが大きいときの注意（随時改定の確認を促す）。無給・給与なしは対象外 */
export function remunerationWarning(totalSalary: number, standardRemuneration: number): string | null {
  if (totalSalary <= 0 || standardRemuneration <= 0) return null;
  const ratio = totalSalary / standardRemuneration;
  if (ratio >= 1.25 || ratio <= 0.75) {
    return `今月の給与（${totalSalary.toLocaleString('ja-JP')}円）が標準報酬月額（${standardRemuneration.toLocaleString('ja-JP')}円）と大きく離れています。随時改定の対象か確認してください`;
  }
  return null;
}

export type CollectionPlan = 'payroll' | 'transfer' | 'none';

/** 本人負担の集め方。給与から引けなければ別途入金 */
export function collectionPlan(due: number, salary: { total: number; noPay: boolean } | null): CollectionPlan {
  if (due <= 0) return 'none';
  if (!salary || salary.noPay || salary.total < due) return 'transfer';
  return 'payroll';
}

export type CollectionStatus = 'none' | 'unpaid' | 'partial' | 'done' | 'over';

export function collectionStatus(due: number, collected: number | null): CollectionStatus {
  if (due <= 0 && !collected) return 'none';
  if (collected === null || collected === 0) return due > 0 ? 'unpaid' : 'none';
  if (collected < due) return 'partial';
  if (collected > due) return 'over';
  return 'done';
}

// ---- 給与CSV ----

export interface SalaryCsvRow {
  line: number;
  employeeNumber: string;
  paymentBasisDays: number;
  baseSalary: number;
  fixedAllowances: Record<string, number>;
  variableAllowances: Record<string, number>;
  inKindAmount: number;
  retroactivePay: { amount: number; fromMonth: string; toMonth: string } | null;
  noPay: boolean;
}

export interface CsvError { line: number; employeeNumber: string; message: string }

/** 給与項目マスタ（CSVの列名と、固定的／非固定的の区分） */
export interface SalaryItem { name: string; kind: 'fixed' | 'variable' }
export const DEFAULT_SALARY_ITEMS: SalaryItem[] = [{ name: '通勤手当', kind: 'fixed' }, { name: '残業手当', kind: 'variable' }];

const KNOWN = ['社員番号', '氏名', '支払基礎日数', '基本給', '現物給与', '遡及差額', '遡及開始月', '遡及終了月', '無給', '備考'];

/** 1行をカンマで区切る（ダブルクォートの囲みと "" に対応） */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { cells.push(cell); cell = ''; }
    else cell += c;
  }
  cells.push(cell);
  return cells.map(v => v.trim());
}

function amount(value: string, label: string): number {
  const text = value.replace(/[,，円\s]/g, '');
  if (text === '') return 0;
  if (!/^\d+$/.test(text)) throw new Error(`${label}は0以上の整数で入力してください（「${value}」）`);
  const n = Number(text);
  if (n > 100_000_000) throw new Error(`${label}が大きすぎます`);
  return n;
}

/** 給与CSVを読み、行ごとの誤りを集める。見出し行は必須。「固定:」「非固定:」で始まる列は手当 */
export function parseSalaryCsv(text: string, items: SalaryItem[] = DEFAULT_SALARY_ITEMS): { rows: SalaryCsvRow[]; errors: CsvError[] } {
  const kindOf = new Map(items.map(i => [i.name, i.kind]));
  // 列の手当の区分：「固定:」「非固定:」が付いていればそれ、なければ給与項目マスタ
  const allowanceOf = (h: string): { name: string; kind: SalaryItem['kind'] } | null => {
    const m = /^(固定|非固定)[:：](.+)$/.exec(h);
    if (m) return { name: m[2], kind: m[1] === '固定' ? 'fixed' : 'variable' };
    const kind = kindOf.get(h);
    return kind ? { name: h, kind } : null;
  };
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const header = splitCsvLine(lines[0] ?? '');
  const errors: CsvError[] = [];
  if (!header.includes('社員番号')) return { rows: [], errors: [{ line: 1, employeeNumber: '', message: '1行目に見出し（社員番号・基本給など）を入れてください' }] };
  const unknown = header.filter(h => h && !KNOWN.includes(h) && !allowanceOf(h));
  if (unknown.length) return { rows: [], errors: [{ line: 1, employeeNumber: '', message: `給与項目に登録されていない列があります：${unknown.join('、')}（給与項目に登録するか、「固定:${unknown[0]}」のように区分を付けてください）` }] };
  const rows: SalaryCsvRow[] = [];
  const seen = new Map<string, number>();
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cells = splitCsvLine(lines[i]);
    const get = (name: string) => cells[header.indexOf(name)] ?? '';
    const line = i + 1;
    const employeeNumber = get('社員番号');
    try {
      if (!employeeNumber) throw new Error('社員番号がありません');
      if (seen.has(employeeNumber)) throw new Error(`${seen.get(employeeNumber)}行目と社員番号が重複しています`);
      seen.set(employeeNumber, line);
      const noPay = /^(1|はい|有|○|true)$/i.test(get('無給'));
      const fixedAllowances: Record<string, number> = {};
      const variableAllowances: Record<string, number> = {};
      header.forEach((h, index) => {
        if (KNOWN.includes(h)) return;
        const item = allowanceOf(h);
        if (!item) return;
        const value = amount(cells[index] ?? '', item.name);
        if (value > 0) (item.kind === 'fixed' ? fixedAllowances : variableAllowances)[item.name] = value;
      });
      const baseSalary = amount(get('基本給'), '基本給');
      const inKindAmount = amount(get('現物給与'), '現物給与');
      const daysText = get('支払基礎日数');
      const paymentBasisDays = daysText === '' ? (noPay ? 0 : NaN) : Number(daysText);
      if (!Number.isInteger(paymentBasisDays) || paymentBasisDays < 0 || paymentBasisDays > 31) throw new Error('支払基礎日数は0〜31の整数で入力してください');
      const total = baseSalary + inKindAmount + Object.values(fixedAllowances).reduce((a, b) => a + b, 0) + Object.values(variableAllowances).reduce((a, b) => a + b, 0);
      if (noPay && total > 0) throw new Error('無給の人に金額が入っています。無給の欄か金額を確認してください');
      if (!noPay && total === 0) throw new Error('金額がありません。給与がない月は「無給」の欄に 1 を入れてください');
      const retro = amount(get('遡及差額'), '遡及差額');
      let retroactivePay: SalaryCsvRow['retroactivePay'] = null;
      if (retro > 0) {
        const fromMonth = get('遡及開始月').replace('/', '-');
        const toMonth = get('遡及終了月').replace('/', '-') || fromMonth;
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(fromMonth) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(toMonth) || fromMonth > toMonth) {
          throw new Error('遡及差額があるときは、遡及開始月・遡及終了月を 2026-04 の形で入力してください');
        }
        if (retro > total) throw new Error('遡及差額が支給額を超えています（遡及差額は手当の列に含めた金額のうちの差額分です）');
        retroactivePay = { amount: retro, fromMonth, toMonth };
      }
      rows.push({ line, employeeNumber, paymentBasisDays, baseSalary, fixedAllowances, variableAllowances, inKindAmount, retroactivePay, noPay });
    } catch (e) {
      errors.push({ line, employeeNumber, message: (e as Error).message });
    }
  }
  if (rows.length === 0 && errors.length === 0) errors.push({ line: 2, employeeNumber: '', message: 'データの行がありません' });
  return { rows, errors };
}
