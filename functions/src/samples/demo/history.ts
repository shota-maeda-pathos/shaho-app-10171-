// 評価用のテストデータの過去の分（2025年12月〜先月）。画面の計算と同じ式で保険料を出し、承認済み・公開済み・徴収済みとして残す。
// 今月（2026年11月支給）は給与だけ入れて、確認から先は画面で進める
import { Timestamp } from 'firebase-admin/firestore';
import { InsurancePremiumBreakdown } from '../../types/firestore';
import { AllRates, rateFingerprint } from '../../utils/insurance-rate';
import { calculateChildSupportPayment } from '../../utils/child-support-payment';
import { isHealthExcluded, isLongTermCareAge, isPensionExcluded } from '../../utils/age';
import { coverageForMonth, employerOnlyPremium, HEALTH_GRADE_TABLE, lookupGrade, PENSION_GRADE_TABLE, RoundingRule, splitPremium } from '../../insurance/calculator';
import { bonusCaps, bonusTarget, summarizePayments } from '../../bonus/bonus-calc';
import { DemoEmployee, DemoOffice } from './data';

/** 履歴の最初の月と今月（支給月） */
export const HISTORY_FROM = '2025-12';
export const CURRENT_PAY_MONTH = '2026-11';

const ZERO: InsurancePremiumBreakdown = { employeeAmount: 0, employerAmount: 0 };

export function addMonths(yearMonth: string, n: number): string {
  const [y, m] = yearMonth.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

/** 2026年4月に昇給した。それより前の月は3%低い基本給 */
export function baseSalaryIn(e: DemoEmployee, yearMonth: string): number {
  return yearMonth < '2026-04' ? Math.round(e.baseSalary * 0.97 / 1000) * 1000 : e.baseSalary;
}

/** 1か月分の給与。月給の人は暦日数、パート・短時間は出勤日数を支払基礎日数にする */
export function salaryIn(e: DemoEmployee, yearMonth: string) {
  const [y, m] = yearMonth.split('-').map(Number);
  const calendarDays = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const days = e.insuredCategory === 'partTimer' ? 17 + (e.n + m) % 3 : e.insuredCategory === 'shortTime' ? 12 + (e.n + m) % 2 : calendarDays;
  const overtime = e.insuredCategory === 'general' ? ((e.n * m) % 6) * 3_000 : 0;
  const base = baseSalaryIn(e, yearMonth);
  return { days, base, overtime, total: base + overtime };
}

export interface DemoGrade {
  effectiveMonth: string;
  determinationType: 'regular' | 'initial';
  basisRemuneration: number;
  basisMonths: string[] | null;
  healthGradeNumber: number; healthStandardRemuneration: number;
  pensionGradeNumber: number; pensionStandardRemuneration: number;
  reason: string;
}

function gradeOf(remuneration: number) {
  const h = lookupGrade(HEALTH_GRADE_TABLE, remuneration);
  const p = lookupGrade(PENSION_GRADE_TABLE, remuneration);
  return { healthGradeNumber: h.gradeNumber, healthStandardRemuneration: h.standardRemuneration, pensionGradeNumber: p.gradeNumber, pensionStandardRemuneration: p.standardRemuneration };
}

/** 4〜6月の報酬の平均（円未満切り捨て） */
function aprilToJune(e: DemoEmployee, year: number): { average: number; months: string[] } {
  const months = [`${year}-04`, `${year}-05`, `${year}-06`];
  return { average: Math.floor(months.reduce((a, m) => a + salaryIn(e, m).total, 0) / 3), months };
}

/** 等級の履歴。5月末までに入社した人は9月の定時決定、それ以外は資格取得時決定 */
export function demoGrades(e: DemoEmployee): DemoGrade[] {
  const out: DemoGrade[] = [];
  const hireMonth = e.hireDate.slice(0, 7);
  for (const year of [2025, 2026]) {
    if (e.hireDate <= `${year}-05-31`) {
      const { average, months } = aprilToJune(e, year);
      out.push({ effectiveMonth: `${year}-09`, determinationType: 'regular', basisRemuneration: average, basisMonths: months, ...gradeOf(average), reason: `${year}年の定時決定` });
    } else if (hireMonth >= `${year}-06` && hireMonth <= `${year + 1}-05`) {
      const s = salaryIn(e, hireMonth);
      out.push({ effectiveMonth: hireMonth, determinationType: 'initial', basisRemuneration: s.base, basisMonths: null, ...gradeOf(s.base), reason: '資格取得時決定' });
    }
  }
  // 入社が2025年6月より前でも、2025年9月より前に決まった等級は履歴の範囲（2025年12月〜）に影響しないので作らない
  return out.sort((a, b) => a.effectiveMonth.localeCompare(b.effectiveMonth));
}

export function gradeFor(grades: DemoGrade[], yearMonth: string): DemoGrade | null {
  return [...grades].reverse().find(g => g.effectiveMonth <= yearMonth) ?? null;
}

/** 保険料（monthlyInsurance）。monthly-insurance-calculate と同じ式。免除・適用外の人はいない前提 */
export function demoPremium(birthDate: Timestamp, grade: DemoGrade, rates: AllRates, rule: RoundingRule, yearMonth: string) {
  const healthExcluded = isHealthExcluded(birthDate, yearMonth);
  const pensionExcluded = isPensionExcluded(birthDate, yearMonth);
  const ltcAge = isLongTermCareAge(birthDate, yearMonth);
  if (!healthExcluded && !rates.health) throw new Error(`${yearMonth} の健康保険料率がありません`);
  if (!pensionExcluded && !rates.pension) throw new Error(`${yearMonth} の厚生年金保険料率がありません`);
  const healthInsurance = healthExcluded || !rates.health ? ZERO
    : splitPremium(grade.healthStandardRemuneration, rates.health.employeeRate, rates.health.employerRate, rule, rates.health.totalRate);
  const longTermCareInsurance = ltcAge && !healthExcluded && rates.longTermCare
    ? splitPremium(grade.healthStandardRemuneration, rates.longTermCare.employeeRate, rates.longTermCare.employerRate, rule, rates.longTermCare.totalRate)
    : null;
  const pensionInsurance = pensionExcluded || !rates.pension ? ZERO
    : splitPremium(grade.pensionStandardRemuneration, rates.pension.employeeRate, rates.pension.employerRate, rule, rates.pension.totalRate);
  const childSupportPayment = calculateChildSupportPayment(grade.healthStandardRemuneration, yearMonth, healthExcluded, rule, rates.childSupportPayment);
  const childSupportContribution = !rates.childSupport || pensionExcluded ? ZERO : employerOnlyPremium(grade.pensionStandardRemuneration, rates.childSupport.employerRate);
  const totalEmployeeAmount = healthInsurance.employeeAmount + (longTermCareInsurance?.employeeAmount ?? 0) + pensionInsurance.employeeAmount + childSupportPayment.employeeAmount;
  const totalEmployerAmount = healthInsurance.employerAmount + (longTermCareInsurance?.employerAmount ?? 0) + pensionInsurance.employerAmount
    + childSupportContribution.employerAmount + childSupportPayment.employerAmount;
  return {
    yearMonth,
    healthGradeNumber: grade.healthGradeNumber, healthStandardRemuneration: grade.healthStandardRemuneration,
    pensionGradeNumber: grade.pensionGradeNumber, pensionStandardRemuneration: grade.pensionStandardRemuneration,
    healthInsurance, longTermCareInsurance, pensionInsurance, childSupportContribution, childSupportPayment,
    totalEmployeeAmount, totalEmployerAmount,
    isExempted: false, isHealthExcluded: healthExcluded, isPensionExcluded: pensionExcluded, isLongTermCareApplicable: ltcAge,
    exemptionIds: [], sameMonthAcquisitionAndLoss: false, roundingRule: rule, rateFingerprint: rateFingerprint(rates),
    gradeOutdated: false, lastRejection: null,
  };
}

/** 賞与の支給月（事業所の支給予定月のうち、履歴の範囲の月） */
export function bonusMonthsFor(office: DemoOffice): string[] {
  return monthsBetween(HISTORY_FROM, addMonths(CURRENT_PAY_MONTH, -1)).filter(m => office.bonusMonths.includes(Number(m.slice(5))));
}

/** 賞与（正社員だけ）。12月は基本給の1.5か月、夏は1.2か月 */
export function demoBonus(e: DemoEmployee, yearMonth: string) {
  if (e.insuredCategory !== 'general' || e.hireDate > `${yearMonth}-10`) return null;
  const months = yearMonth.endsWith('-12') ? 1.5 : 1.2;
  const payments = [{ date: `${yearMonth}-10`, cash: Math.round(baseSalaryIn(e, yearMonth) * months / 1000) * 1000 + 3_456, inKind: 0 }];
  return summarizePayments(payments);
}

/** 賞与の保険料（bonusInsurance）。bonus-insurance-calculate と同じ式。同じ年度に前の賞与はない月だけを使う */
export function demoBonusPremium(birthDate: Timestamp, hireDate: string, bonus: NonNullable<ReturnType<typeof demoBonus>>, rates: AllRates, rule: RoundingRule, yearMonth: string, priorCumulative: number) {
  const caps = bonusCaps(bonus.standard, priorCumulative);
  const target = bonusTarget({ yearMonth, firstPaymentDate: bonus.firstPaymentDate, acquisitionDate: hireDate, lossDate: null, enrolled: true });
  const healthExcl = isHealthExcluded(birthDate, yearMonth);
  const pensionExcl = isPensionExcluded(birthDate, yearMonth);
  const ltcAge = isLongTermCareAge(birthDate, yearMonth);
  const healthInsurance = healthExcl || !rates.health ? ZERO : splitPremium(caps.healthCapped, rates.health.employeeRate, rates.health.employerRate, rule, rates.health.totalRate);
  const longTermCareInsurance = ltcAge && !healthExcl && rates.longTermCare
    ? splitPremium(caps.healthCapped, rates.longTermCare.employeeRate, rates.longTermCare.employerRate, rule, rates.longTermCare.totalRate) : null;
  const pensionInsurance = pensionExcl || !rates.pension ? ZERO : splitPremium(caps.pensionCapped, rates.pension.employeeRate, rates.pension.employerRate, rule, rates.pension.totalRate);
  const childSupportPayment = calculateChildSupportPayment(caps.healthCapped, yearMonth, healthExcl, rule, rates.childSupportPayment);
  const childSupportContribution = !rates.childSupport || pensionExcl ? ZERO : employerOnlyPremium(caps.pensionCapped, rates.childSupport.employerRate);
  return {
    yearMonth, totalBonusAmount: bonus.total, standardBonusAmount: bonus.standard, priorCumulativeBonusAmount: priorCumulative,
    cumulativeBonusAmount: caps.healthCumulative, healthOverCap: caps.healthOverCap, pensionOverCap: caps.pensionOverCap,
    bonusTarget: target.target, bonusTargetReason: target.reason,
    healthCappedAmount: caps.healthCapped, pensionCappedAmount: caps.pensionCapped,
    healthInsurance, longTermCareInsurance, pensionInsurance, childSupportContribution, childSupportPayment,
    totalEmployeeAmount: healthInsurance.employeeAmount + (longTermCareInsurance?.employeeAmount ?? 0) + pensionInsurance.employeeAmount + childSupportPayment.employeeAmount,
    totalEmployerAmount: healthInsurance.employerAmount + (longTermCareInsurance?.employerAmount ?? 0) + pensionInsurance.employerAmount + childSupportContribution.employerAmount + childSupportPayment.employerAmount,
    isExempted: false, isHealthExcluded: healthExcl, isPensionExcluded: pensionExcl, isLongTermCareApplicable: ltcAge,
    exemptionIds: [], rateFingerprint: rateFingerprint(rates),
  };
}

/**
 * 1人分の月ごとの予定。保険料を計算する月（premiumMonths）と、給与の支給月ごとの控除する保険料の月。
 * 当月控除の事業所は先月分まで、翌月控除の事業所は先々月分まで保険料が終わっている（今月の支給で控除する分は画面で計算する）
 */
export function demoSchedule(e: DemoEmployee, office: DemoOffice) {
  const hireMonth = e.hireDate.slice(0, 7);
  const start = hireMonth > HISTORY_FROM ? hireMonth : HISTORY_FROM;
  const lastPayDone = addMonths(CURRENT_PAY_MONTH, -1);
  const deductedOf = (payMonth: string) => (office.deductionMethod === 'previous' ? addMonths(payMonth, -1) : payMonth);
  const premiumMonths = monthsBetween(start, deductedOf(lastPayDone)).filter(m => coverageForMonth(e.hireDate, null, m).charged);
  const payMonths = monthsBetween(start, CURRENT_PAY_MONTH).map(payMonth => {
    const deducted = deductedOf(payMonth);
    return { payMonth, done: payMonth <= lastPayDone, deductedPremiumMonth: premiumMonths.includes(deducted) ? deducted : null };
  });
  return { premiumMonths, payMonths };
}
