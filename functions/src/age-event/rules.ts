import { GradeTableEntry } from '../types/firestore';
import { fiveDayDeadline, addMonths, ageReachDate, lookupGrade, monthOf, nthBirthday } from '../insurance/calculator';

/**
 * 年齢到達（純粋関数）。年齢は誕生日の前日に加わる（年齢計算ニ関スル法律）。
 * - 40歳：到達日（誕生日の前日）の月から介護保険料がかかる（届出なし）
 * - 65歳：到達日の月の前月で介護保険料が終わる（届出なし。介護保険の第1号被保険者になる）
 * - 70歳：到達日に厚生年金の資格を失い、到達日の月の前月まで厚生年金保険料がかかる。
 *   70歳以上被用者として働き続ける。到達日の標準報酬月額相当額が到達前の標準報酬月額と同じなら届出は原則いらない
 * - 75歳：誕生日当日に健康保険の資格を失い（後期高齢者医療制度へ）、誕生日の月の前月まで健康保険料がかかる。資格喪失届を出す
 */

export type AgeMilestone = 40 | 65 | 70 | 75;
/** 手続き（届出）がある年齢到達 */
export type AgeEventKind = 'pension70' | 'health75';

export const KIND_OF: Partial<Record<AgeMilestone, AgeEventKind>> = { 70: 'pension70', 75: 'health75' };
export const AGE_OF: Record<AgeEventKind, 70 | 75> = { pension70: 70, health75: 75 };

export const KIND_LABEL: Record<AgeEventKind, string> = {
  pension70: '70歳到達（厚生年金の喪失）',
  health75: '75歳到達（健康保険の喪失）',
};

export const FILING_TYPE: Record<AgeEventKind, string> = {
  pension70: 'pensionLoss70',
  health75: 'lossNotification',
};

export const FILING_LABEL: Record<AgeEventKind, string> = {
  pension70: '資格喪失届・70歳以上被用者該当届',
  health75: '資格喪失届（75歳到達）',
};

const ym = (m: string) => `${Number(m.slice(0, 4))}年${Number(m.slice(5, 7))}月`;

export interface MilestoneFacts {
  age: AgeMilestone;
  /** 年齢に達する日（誕生日の前日） */
  reachDate: string;
  /** 起きる日（40・65・70歳は到達日、75歳は誕生日＝健康保険の喪失日） */
  eventDate: string;
  /** 保険料が変わる最初の月（40歳は介護がかかり始める月、ほかはかからなくなる月） */
  changeMonth: string;
  /** 何が変わるか */
  effect: string;
  kind: AgeEventKind | null;
}

export function milestoneFacts(birthDate: string, age: AgeMilestone): MilestoneFacts {
  const reachDate = ageReachDate(birthDate, age);
  const eventDate = age === 75 ? nthBirthday(birthDate, 75) : reachDate;
  const changeMonth = monthOf(eventDate);
  const last = ym(addMonths(changeMonth, -1));
  const effect = {
    40: `介護保険の第2号被保険者になり、${ym(changeMonth)}分の保険料から介護保険料がかかります`,
    65: `介護保険料は${last}分までです（${ym(changeMonth)}分から市区町村が徴収）`,
    70: `厚生年金の資格を失い、厚生年金保険料は${last}分までです。70歳以上被用者として働き続けます`,
    75: `健康保険の資格を失い（後期高齢者医療制度へ）、健康保険料は${last}分までです`,
  }[age];
  return { age, reachDate, eventDate, changeMonth, effect, kind: KIND_OF[age] ?? null };
}

/** from〜to（YYYY-MM-DD、両端を含む）に起きる年齢到達 */
export function milestonesBetween(birthDate: string, from: string, to: string): MilestoneFacts[] {
  return ([40, 65, 70, 75] as AgeMilestone[])
    .map(age => milestoneFacts(birthDate, age))
    .filter(m => m.eventDate >= from && m.eventDate <= to);
}

/** 届出の期限（起きた日から5日。初日は数えない） */
export function deadlineOf(eventDate: string): string {
  return fiveDayDeadline(eventDate);
}

// ── 70歳：届出が要るか ───────────────────────────────

export interface Pension70Input {
  /** 70歳到達日の報酬月額（固定的賃金＋非固定的賃金の平均。担当者が確かめた額） */
  remuneration: number | null;
  /** 到達日の前日の厚生年金の標準報酬月額 */
  currentPensionStandard: number | null;
  pensionTable: GradeTableEntry[];
}

export interface Pension70Result {
  /** 標準報酬月額相当額 */
  equivalentGrade: number | null;
  equivalentStandard: number | null;
  /** 届出が要る（相当額が到達前と違う）。判定できなければ null */
  filingRequired: boolean | null;
  message: string;
}

/**
 * 70歳到達時の届出の要否（日本年金機構：70歳到達日時点の標準報酬月額相当額が、到達日の前日の標準報酬月額と同じなら届出不要）
 */
export function pension70Filing(i: Pension70Input): Pension70Result {
  if (i.remuneration === null || i.remuneration <= 0) {
    return { equivalentGrade: null, equivalentStandard: null, filingRequired: null, message: '70歳到達日の報酬月額を入れてください' };
  }
  const g = lookupGrade(i.pensionTable, i.remuneration);
  if (i.currentPensionStandard === null) {
    return { equivalentGrade: g.gradeNumber, equivalentStandard: g.standardRemuneration, filingRequired: true, message: '到達前の厚生年金の等級がないため、届出を出してください' };
  }
  const same = g.standardRemuneration === i.currentPensionStandard;
  return {
    equivalentGrade: g.gradeNumber, equivalentStandard: g.standardRemuneration, filingRequired: !same,
    message: same
      ? `標準報酬月額相当額（${g.standardRemuneration.toLocaleString('ja-JP')}円）が到達前と同じため、届出は原則いりません（日本年金機構が手続きします）`
      : `標準報酬月額相当額（${g.standardRemuneration.toLocaleString('ja-JP')}円）が到達前（${i.currentPensionStandard.toLocaleString('ja-JP')}円）と違うため、資格喪失届・70歳以上被用者該当届を出します`,
  };
}

/** 70歳到達日の報酬月額の目安：直近の給与の固定的賃金＋直近3か月の非固定的賃金の平均（現物を含む） */
export function remunerationEstimate(salaries: { totalFixedWage: number; totalVariableWage: number; inKind: number }[]): number | null {
  if (!salaries.length) return null;
  const latest = salaries[0];
  const recent = salaries.slice(0, 3);
  const variable = Math.floor(recent.reduce((s, x) => s + x.totalVariableWage, 0) / recent.length);
  return latest.totalFixedWage + variable + latest.inKind;
}
