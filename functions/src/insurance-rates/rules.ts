// 料率の CSV 取込（カタログ1章・6章）。料率は‰（例：健康保険 99.1）で持つ

export type RateType = 'health' | 'pension' | 'childSupport' | 'childSupportPayment' | 'longTermCare';

export const RATE_TYPE_LABELS: Record<RateType, string> = {
  health: '健康保険', longTermCare: '介護保険', pension: '厚生年金', childSupport: '子ども・子育て拠出金', childSupportPayment: '子ども・子育て支援金',
};

export interface RateRow {
  line: number;
  insuranceType: RateType;
  prefectureCode: string;
  insurerId: string;
  appliedFrom: string;
  totalRate: number;
  employeeRate: number;
  employerRate: number;
  note: string;
}

export const CSV_HEADER = '保険の種類,都道府県コード,保険者ID,適用開始年月,料率(‰),本人負担(‰),会社負担(‰),備考';

function typeOf(v: string): RateType | null {
  const s = v.trim();
  if ((Object.keys(RATE_TYPE_LABELS) as RateType[]).includes(s as RateType)) return s as RateType;
  return (Object.entries(RATE_TYPE_LABELS).find(([, label]) => label === s)?.[0] as RateType | undefined) ?? null;
}

/** 料率の単位の目安（‰）。小数（0.0991）や％（9.91）の取り違えを止める */
const RANGE: Record<RateType, [number, number]> = {
  health: [50, 150], longTermCare: [5, 30], pension: [150, 200], childSupport: [0.5, 10], childSupportPayment: [0.1, 10],
};

export function parseRateCsv(text: string, split: (line: string) => string[]): { rows: RateRow[]; errors: string[] } {
  const rows: RateRow[] = [];
  const errors: string[] = [];
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = i + 1;
    if (!raw.trim() || (i === 0 && raw.includes('保険の種類'))) return;
    const c = split(raw).map(s => s.trim());
    const type = typeOf(c[0] ?? '');
    if (!type) { errors.push(`${line}行目：保険の種類「${c[0] ?? ''}」が分かりません（${Object.values(RATE_TYPE_LABELS).join('・')}）`); return; }
    const pref = c[1] ?? '';
    if (pref && !/^\d{2}$/.test(pref)) { errors.push(`${line}行目：都道府県コードは2桁の数字です（全国一律は空欄）`); return; }
    const from = c[3] ?? '';
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(from)) { errors.push(`${line}行目：適用開始年月は YYYY-MM で書いてください`); return; }
    const total = Number(c[4]);
    if (!Number.isFinite(total) || total <= 0) { errors.push(`${line}行目：料率が数字ではありません`); return; }
    const [lo, hi] = RANGE[type];
    if (total < lo || total > hi) { errors.push(`${line}行目：${RATE_TYPE_LABELS[type]}の料率 ${total} は‰として範囲外です（${lo}〜${hi}）。％や小数で書いていないか確かめてください`); return; }
    const employerOnly = type === 'childSupport';
    const employee = c[5] ? Number(c[5]) : employerOnly ? 0 : total / 2;
    const employer = c[6] ? Number(c[6]) : employerOnly ? total : total / 2;
    if (!Number.isFinite(employee) || !Number.isFinite(employer) || Math.abs(employee + employer - total) > 0.0001) {
      errors.push(`${line}行目：本人負担と会社負担の合計が料率と合いません`); return;
    }
    if (type !== 'health' && pref && type !== 'longTermCare') { errors.push(`${line}行目：${RATE_TYPE_LABELS[type]}は全国一律なので、都道府県コードは空欄にしてください`); return; }
    rows.push({ line, insuranceType: type, prefectureCode: pref, insurerId: c[2] ?? '', appliedFrom: from, totalRate: total, employeeRate: employee, employerRate: employer, note: c[7] ?? '' });
  });
  const keys = new Set<string>();
  for (const r of rows) {
    const k = `${r.insuranceType}|${r.prefectureCode}|${r.insurerId}|${r.appliedFrom}`;
    if (keys.has(k)) errors.push(`${r.line}行目：同じ種類・都道府県・保険者・開始月の行が2つあります`);
    keys.add(k);
  }
  return { rows, errors };
}

/** 'YYYY-MM' の前の月 */
export function previousMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}
