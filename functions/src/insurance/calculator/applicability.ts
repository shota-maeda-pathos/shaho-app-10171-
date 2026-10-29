import { correspondingDayAfterMonths } from './dates';
import { InsuredCategory } from './payment-basis';

export type ApplicabilityResult = 'applicable' | 'notApplicable' | 'manual';

export interface ApplicabilityInput {
  employmentType: 'regular' | 'contract' | 'partTime' | 'arbeit' | 'executiveFull' | 'executivePart';
  weeklyHours: number;
  monthlyDays: number;
  /** 通常の労働者の週所定労働時間・月所定労働日数 */
  fullTimeWeeklyHours: number;
  fullTimeMonthlyDays: number;
  /** 特定適用事業所（厚生年金の被保険者数が基準以上）か。null は未登録 */
  isSpecificApplicableOffice: boolean | null;
  contractType: 'indefinite' | 'fixed';
  contractStartDate?: string | null;
  contractEndDate?: string | null;
  renewalExpected: boolean;
  isStudent: boolean;
}

export interface ApplicabilityJudgement {
  result: ApplicabilityResult;
  reason: string;
  applicabilityReason: 'standard' | 'specificShortTime' | 'excluded';
  insuredCategory: InsuredCategory | null;
}

/** 有期雇用で2か月以内に終わり、更新の見込みもない契約か */
function endsWithinTwoMonths(input: ApplicabilityInput): boolean {
  if (input.contractType !== 'fixed' || input.renewalExpected) return false;
  if (!input.contractStartDate || !input.contractEndDate) return false;
  // 2か月の期間は2か月後の応当日の前日に満了する
  return input.contractEndDate < correspondingDayAfterMonths(input.contractStartDate, 2);
}

/**
 * 社会保険（健康保険・厚生年金）の適用判定。結果は提示であり、担当者が確認して確定する。
 * 1. 非常勤役員は自動判定しない
 * 2. 2か月以内の有期契約で更新見込みがなければ適用外
 * 3. 週の所定労働時間と月の所定労働日数がともに通常の労働者の3/4以上なら適用
 * 4. 3/4未満でも、特定適用事業所で週20時間以上・2か月超の雇用見込み・学生でなければ短時間労働者として適用
 *    （2026年10月から月額8.8万円の賃金要件は撤廃）
 */
export function judgeApplicability(input: ApplicabilityInput): ApplicabilityJudgement {
  if (input.employmentType === 'executivePart') {
    return { result: 'manual', reason: '非常勤役員は担当者が適用・適用外を判断してください', applicabilityReason: 'excluded', insuredCategory: null };
  }
  if (endsWithinTwoMonths(input)) {
    return { result: 'notApplicable', reason: '2か月以内の有期契約で更新の見込みがないため適用外です', applicabilityReason: 'excluded', insuredCategory: null };
  }
  const meetsThreeQuarters = input.weeklyHours * 4 >= input.fullTimeWeeklyHours * 3
    && input.monthlyDays * 4 >= input.fullTimeMonthlyDays * 3;
  if (meetsThreeQuarters) {
    const partTime = input.employmentType === 'partTime' || input.employmentType === 'arbeit';
    return {
      result: 'applicable',
      reason: '所定労働時間・日数が通常の労働者の3/4以上です',
      applicabilityReason: 'standard',
      insuredCategory: partTime ? 'partTimer' : 'general',
    };
  }
  if (input.isSpecificApplicableOffice === null) {
    return { result: 'manual', reason: '3/4基準を満たしません。会社設定で特定適用事業所かどうかを登録するか、担当者が判断してください', applicabilityReason: 'excluded', insuredCategory: null };
  }
  if (!input.isSpecificApplicableOffice) {
    return { result: 'notApplicable', reason: '3/4基準を満たさず、特定適用事業所でもないため適用外です', applicabilityReason: 'excluded', insuredCategory: null };
  }
  const shortfalls: string[] = [];
  if (input.weeklyHours < 20) shortfalls.push('週の所定労働時間が20時間未満');
  if (input.isStudent) shortfalls.push('学生');
  if (shortfalls.length) {
    return { result: 'notApplicable', reason: `短時間労働者の要件を満たしません（${shortfalls.join('・')}）`, applicabilityReason: 'excluded', insuredCategory: null };
  }
  return { result: 'applicable', reason: '特定適用事業所の短時間労働者として適用です', applicabilityReason: 'specificShortTime', insuredCategory: 'shortTime' };
}
