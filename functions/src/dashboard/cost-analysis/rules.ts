// 保険料の集計・分析（カタログ12章）の計算。読み込みは service.ts

export interface MonthRecord {
  employeeId: string;
  yearMonth: string;
  healthGrade: number;
  pensionGrade: number;
  health: { employee: number; employer: number };
  care: { employee: number; employer: number };
  childSupport: { employee: number; employer: number };
  pension: { employee: number; employer: number };
  totalEmployee: number;
  totalEmployer: number;
  isExempted: boolean;
}

/** 年度（4月〜翌3月）の月の一覧 */
export function fiscalMonths(fiscalYear: number): string[] {
  return Array.from({ length: 12 }, (_, i) => {
    const m = ((i + 3) % 12) + 1;
    const y = m >= 4 ? fiscalYear : fiscalYear + 1;
    return `${y}-${String(m).padStart(2, '0')}`;
  });
}

/** 'YYYY-MM' の年度 */
export function fiscalYearOf(ym: string): number {
  const [y, m] = ym.split('-').map(Number);
  return m >= 4 ? y : y - 1;
}

/** 保険の種類ごとの内訳（本人・会社） */
export function breakdown(records: MonthRecord[]) {
  const sum = (k: 'health' | 'care' | 'childSupport' | 'pension') => ({
    employee: records.reduce((a, r) => a + r[k].employee, 0),
    employer: records.reduce((a, r) => a + r[k].employer, 0),
  });
  return { health: sum('health'), care: sum('care'), childSupport: sum('childSupport'), pension: sum('pension') };
}

export type ChangeFactor = 'joined' | 'left' | 'grade' | 'exemption' | 'other';

/** 前月からの増減を要因に分ける（本人＋会社の合計で） */
export function changeFactors(prev: MonthRecord[], cur: MonthRecord[]): Record<ChangeFactor, number> {
  const before = new Map(prev.map(r => [r.employeeId, r]));
  const after = new Map(cur.map(r => [r.employeeId, r]));
  const total = (r?: MonthRecord) => (r ? r.totalEmployee + r.totalEmployer : 0);
  const out: Record<ChangeFactor, number> = { joined: 0, left: 0, grade: 0, exemption: 0, other: 0 };
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(id), b = after.get(id);
    const delta = total(b) - total(a);
    if (delta === 0) continue;
    if (!a) out.joined += delta;
    else if (!b) out.left += delta;
    else if (a.isExempted !== b.isExempted) out.exemption += delta;
    else if (a.healthGrade !== b.healthGrade || a.pensionGrade !== b.pensionGrade) out.grade += delta;
    else out.other += delta;
  }
  return out;
}

/** 健康保険の等級ごとの人数 */
export function gradeHistogram(records: MonthRecord[]): { grade: number; count: number }[] {
  const m = new Map<number, number>();
  for (const r of records) m.set(r.healthGrade, (m.get(r.healthGrade) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([grade, count]) => ({ grade, count }));
}

/** 年間の会社負担：実績（確定した月＋賞与）と、見込み（直近の月が年度末まで続くと仮定） */
export function annualCost(months: string[], employerByMonth: Map<string, number>, bonusEmployer: number, basisMonth: string | null = null) {
  const done = months.filter(m => employerByMonth.has(m));
  const actualMonthly = done.reduce((a, m) => a + (employerByMonth.get(m) ?? 0), 0);
  // 見込みの元にする月（確定が途中の月は使わない）。それより後の月は、元の月と同じ額が続くとみなす
  const basis = basisMonth && employerByMonth.has(basisMonth) ? basisMonth : done.at(-1);
  const remaining = months.length - done.length;
  const upToBasis = basis ? months.filter(m => m <= basis).reduce((a, m) => a + (employerByMonth.get(m) ?? 0), 0) : 0;
  const after = basis ? months.filter(m => m > basis).length : 0;
  const forecast = upToBasis + bonusEmployer + (basis ? (employerByMonth.get(basis) ?? 0) * after : 0);
  return { actualMonthly, bonusEmployer, actual: actualMonthly + bonusEmployer, confirmedMonths: done.length, forecast, remainingMonths: remaining };
}
