// 賞与の判定（純粋関数）。標準賞与額・年度累計（健保573万円）・月の上限（厚年150万円）・同月合算・年4回以上・届出の要否
import { addDays, coverageForMonth } from '../insurance/calculator';

/** 健康保険の標準賞与額の年度（4月〜翌3月）累計の上限 */
export const HEALTH_BONUS_CAP = 5_730_000;
/** 厚生年金の標準賞与額の1か月あたりの上限（同じ月の支給は合算して判定） */
export const PENSION_BONUS_CAP = 1_500_000;
/** 年度累計がこの割合を超えたら「上限に近い」と知らせる */
export const NEAR_CAP_RATIO = 0.8;
/** 同じ年度でこの回数目の支給から、報酬月額への算入が必要（本システムでは対応しない） */
export const FOURTH_PAYMENT = 4;

export interface BonusPayment {
  /** 支給日（YYYY-MM-DD） */
  date: string;
  cash: number;
  inKind: number;
}

/** 千円未満を切り捨てる */
export const toThousand = (amount: number) => Math.floor(amount / 1000) * 1000;

/** 年度（4月始まり）。2027-03 は 2026 年度 */
export function fiscalYearOf(yearMonth: string): number {
  const y = Number(yearMonth.slice(0, 4));
  return Number(yearMonth.slice(5, 7)) >= 4 ? y : y - 1;
}

/** その年度の、指定の月より前の月（4月から） */
export function earlierMonthsInFiscalYear(yearMonth: string): string[] {
  const fy = fiscalYearOf(yearMonth);
  const months: string[] = [];
  for (let i = 0; i < 12; i++) {
    const m = ((3 + i) % 12) + 1;
    const ym = `${m >= 4 ? fy : fy + 1}-${String(m).padStart(2, '0')}`;
    if (ym >= yearMonth) break;
    months.push(ym);
  }
  return months;
}

/**
 * 1か月分の支給をまとめる（同月合算）。届出には初回の支給日と合算額を書く。
 * 標準賞与額は合算額の千円未満を切り捨てた額
 */
export function summarizePayments(payments: BonusPayment[]) {
  const sorted = [...payments].sort((a, b) => a.date.localeCompare(b.date));
  const cash = sorted.reduce((a, p) => a + p.cash, 0);
  const inKind = sorted.reduce((a, p) => a + p.inKind, 0);
  return {
    payments: sorted,
    cash, inKind, total: cash + inKind,
    standard: toThousand(cash + inKind),
    firstPaymentDate: sorted[0]?.date ?? null,
    combined: sorted.length > 1,
  };
}

/** 支給の誤り（登録を止める） */
export function paymentErrors(yearMonth: string, payments: BonusPayment[]): string[] {
  const errors: string[] = [];
  if (!payments.length) errors.push('支給がありません');
  for (const p of payments) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date) || p.date.slice(0, 7) !== yearMonth) errors.push(`支給日（${p.date || '空欄'}）が${yearMonth}の日付ではありません`);
    if (!Number.isSafeInteger(p.cash) || p.cash < 0 || !Number.isSafeInteger(p.inKind) || p.inKind < 0) errors.push('金額は0以上の整数で入れてください');
    else if (p.cash + p.inKind === 0) errors.push(`${p.date}の支給額が0円です`);
    else if (p.cash + p.inKind > 100_000_000) errors.push(`${p.date}の支給額が大きすぎます`);
  }
  if (new Set(payments.map(p => p.date)).size !== payments.length) errors.push('同じ支給日が2回あります（同じ日の支給は1行にまとめてください）');
  return errors;
}

export interface BonusCaps {
  /** この年度の前の月までの標準賞与額の累計（健保） */
  priorHealthCumulative: number;
  /** 今回を含めた累計 */
  healthCumulative: number;
  /** 健保の保険料の対象になる額 */
  healthCapped: number;
  /** 厚年の保険料の対象になる額 */
  pensionCapped: number;
  healthOverCap: boolean;
  pensionOverCap: boolean;
  /** 上限に近い（上限の8割を超えたが、まだ超えていない） */
  nearHealthCap: boolean;
}

/** 上限の判定。年度累計は保険料の免除・資格喪失月の賞与も含めて数える */
export function bonusCaps(standard: number, priorHealthCumulative: number): BonusCaps {
  const healthCumulative = priorHealthCumulative + standard;
  const healthCapped = Math.min(standard, Math.max(0, HEALTH_BONUS_CAP - priorHealthCumulative));
  const pensionCapped = Math.min(standard, PENSION_BONUS_CAP);
  return {
    priorHealthCumulative, healthCumulative, healthCapped, pensionCapped,
    healthOverCap: healthCumulative > HEALTH_BONUS_CAP,
    pensionOverCap: standard > PENSION_BONUS_CAP,
    nearHealthCap: healthCumulative > HEALTH_BONUS_CAP * NEAR_CAP_RATIO && healthCumulative <= HEALTH_BONUS_CAP,
  };
}

export type BonusTarget =
  /** 保険料がかかり、届出を出す */
  | 'charged'
  /** 資格喪失月の支給：保険料はかからないが、届出は出す（健保の年度累計に入る） */
  | 'lossMonth'
  /** 届出も保険料も要らない（資格がない・適用外・喪失後の支給） */
  | 'excluded';

/**
 * 保険料と届出の要否。資格は支給日で判定する（喪失日以後の支給は被保険者の賞与ではない）。
 * 資格喪失月（喪失日より前）の支給は、保険料はかからないが賞与支払届は出す
 */
export function bonusTarget(input: {
  yearMonth: string; firstPaymentDate: string | null; acquisitionDate: string | null; lossDate: string | null; enrolled: boolean;
}): { target: BonusTarget; reason: string } {
  if (!input.enrolled) return { target: 'excluded', reason: '社会保険の適用外です' };
  if (!input.acquisitionDate) return { target: 'excluded', reason: '資格取得日（入社日）が未登録です' };
  const date = input.firstPaymentDate ?? `${input.yearMonth}-01`;
  if (date < input.acquisitionDate) return { target: 'excluded', reason: '資格取得日より前の支給です' };
  if (input.lossDate && date >= input.lossDate) return { target: 'excluded', reason: '資格喪失日以後の支給のため、届出は要りません' };
  const coverage = coverageForMonth(input.acquisitionDate, input.lossDate, input.yearMonth);
  if (!coverage.charged) return { target: 'lossMonth', reason: '資格喪失月の支給のため保険料はかかりません（賞与支払届は出します）' };
  return { target: 'charged', reason: '' };
}

/** 年度内の支給回数（今回を含む）が4回以上なら警告 */
export function paymentCountWarning(priorPaymentCount: number, thisMonthCount: number): string | null {
  const count = priorPaymentCount + thisMonthCount;
  if (count < FOURTH_PAYMENT) return null;
  return `この年度の${count}回目の賞与です。年4回以上の賞与は報酬月額に算入する必要がありますが、本システムでは対応しません（別途手続きが必要です）`;
}

/** 上限の知らせ（画面・取込の確認に出す） */
export function capWarnings(caps: BonusCaps): string[] {
  const out: string[] = [];
  const man = (n: number) => `${Math.floor(n / 10_000).toLocaleString('ja-JP')}万円`;
  if (caps.healthOverCap) out.push(`健康保険の年度累計が上限（573万円）を超えます。超えた分（${man(caps.healthCumulative - HEALTH_BONUS_CAP)}）には保険料がかかりません`);
  else if (caps.nearHealthCap) out.push(`健康保険の年度累計が${man(caps.healthCumulative)}で、上限（573万円）に近づいています`);
  if (caps.pensionOverCap) out.push('厚生年金の上限（1か月150万円）を超えます。超えた分には保険料がかかりません');
  return out;
}

/** 賞与支払届の期限：支給日から5日以内（初回の支給日で数える） */
export function bonusFilingDeadline(firstPaymentDate: string): string {
  return addDays(firstPaymentDate, 5);
}

/** 事業所の賞与支給予定月か（予定月に賞与がなければ不支給報告書が必要） */
export function isScheduledMonth(bonusMonths: number[] | undefined, yearMonth: string): boolean {
  return (bonusMonths ?? []).includes(Number(yearMonth.slice(5, 7)));
}

/** 届出の1人分 */
export interface BonusFilingPerson {
  employeeId: string;
  被保険者整理番号: string;
  被保険者氏名: string;
  生年月日: string;
  /** 初回の支給日 */
  賞与支払年月日: string;
  賞与額_通貨: number;
  賞与額_現物: number;
  賞与額_合計: number;
  /** 千円未満を切り捨てた額 */
  標準賞与額: number;
  /** 備考の番号：1=70歳以上被用者 3=同一月内の賞与合算 */
  備考区分: number[];
  /** 同一月内の賞与合算のときの初回の支払日（日） */
  初回支払日: number | null;
}

export function bonusFilingPerson(input: {
  employeeId: string; insuredPersonNumber: string; name: string; birthDate: string; age70: boolean; payments: BonusPayment[];
}): BonusFilingPerson {
  const s = summarizePayments(input.payments);
  const notes: number[] = [];
  if (input.age70) notes.push(1);
  if (s.combined) notes.push(3);
  return {
    employeeId: input.employeeId, 被保険者整理番号: input.insuredPersonNumber, 被保険者氏名: input.name, 生年月日: input.birthDate,
    賞与支払年月日: s.firstPaymentDate ?? '', 賞与額_通貨: s.cash, 賞与額_現物: s.inKind, 賞与額_合計: s.total, 標準賞与額: s.standard,
    備考区分: notes, 初回支払日: s.combined && s.firstPaymentDate ? Number(s.firstPaymentDate.slice(8, 10)) : null,
  };
}

/** 支給日の一覧から、届出の共通の支払日（いちばん多い日、同数なら早い日） */
export function commonPaymentDate(dates: string[]): string | null {
  const count = new Map<string, number>();
  for (const d of dates) count.set(d, (count.get(d) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
}

export interface BonusCsvRow { lines: number[]; employeeNumber: string; payments: BonusPayment[] }
export interface BonusCsvError { line: number; employeeNumber: string; message: string }

const CSV_COLUMNS = ['社員番号', '氏名', '支給日', '賞与額', '通貨', '現物', '備考'];

function csvAmount(value: string, label: string): number {
  const text = value.replace(/[,，円\s]/g, '');
  if (text === '') return 0;
  if (!/^\d+$/.test(text)) throw new Error(`${label}は0以上の整数で入力してください（「${value}」）`);
  return Number(text);
}

function csvDate(value: string): string {
  const m = /^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?$/.exec(value.trim());
  if (!m) throw new Error(`支給日は 2026-12-10 の形で入れてください（「${value}」）`);
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

/**
 * 賞与CSVを読む。見出し：社員番号・支給日・賞与額（または通貨）・現物（任意）・氏名（任意）。
 * 同じ人の行が複数あれば、同じ月の別の支給（同月合算）として扱う
 */
export function parseBonusCsv(text: string, yearMonth: string, split: (line: string) => string[]): { rows: BonusCsvRow[]; errors: BonusCsvError[] } {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const header = split(lines[0] ?? '');
  const errors: BonusCsvError[] = [];
  if (!header.includes('社員番号') || !header.includes('支給日') || !(header.includes('賞与額') || header.includes('通貨'))) {
    return { rows: [], errors: [{ line: 1, employeeNumber: '', message: '1行目に見出し（社員番号・支給日・賞与額・現物）を入れてください' }] };
  }
  const unknown = header.filter(h => h && !CSV_COLUMNS.includes(h));
  if (unknown.length) return { rows: [], errors: [{ line: 1, employeeNumber: '', message: `使えない列があります：${unknown.join('、')}（社員番号・氏名・支給日・賞与額・現物・備考）` }] };
  const byNumber = new Map<string, BonusCsvRow>();
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cells = split(lines[i]);
    const get = (name: string) => header.includes(name) ? cells[header.indexOf(name)] ?? '' : '';
    const line = i + 1;
    const employeeNumber = get('社員番号');
    try {
      if (!employeeNumber) throw new Error('社員番号がありません');
      const payment = { date: csvDate(get('支給日')), cash: csvAmount(get('賞与額') || get('通貨'), '賞与額'), inKind: csvAmount(get('現物'), '現物') };
      const own = paymentErrors(yearMonth, [payment]);
      if (own.length) throw new Error(own.join('。'));
      const row = byNumber.get(employeeNumber) ?? { lines: [], employeeNumber, payments: [] };
      if (row.payments.some(p => p.date === payment.date)) throw new Error(`${row.lines[0]}行目と同じ人・同じ支給日です（同じ日の支給は1行にまとめてください）`);
      row.lines.push(line);
      row.payments.push(payment);
      byNumber.set(employeeNumber, row);
    } catch (e) {
      errors.push({ line, employeeNumber, message: (e as Error).message });
    }
  }
  // 誤りのある行がある人は、その人の行をすべて取り込まない（支給の一部だけが入るのを防ぐ）
  const failed = new Set(errors.map(e => e.employeeNumber));
  const rows = [...byNumber.values()].filter(r => {
    if (!failed.has(r.employeeNumber)) return true;
    for (const line of r.lines) errors.push({ line, employeeNumber: r.employeeNumber, message: 'この人のほかの行に誤りがあるため取り込みません' });
    return false;
  });
  errors.sort((a, b) => a.line - b.line);
  return { rows, errors };
}
