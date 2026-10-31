import { InsuranceRateDoc } from '../types/firestore';
import { AllRates } from '../utils/insurance-rate';
import { calculateChildSupportPayment } from '../utils/child-support-payment';
import { RoundingRule, employerOnlyPremium, lookupGrade, resolveGradeTable, splitPremium } from '../insurance/calculator';

/**
 * 試算の保険料（本処理と同じ料率・等級表・端数処理）。月額は標準報酬月額、賞与は上限で切った標準賞与額を渡す。
 * 介護保険は40〜64歳、厚生年金は70歳未満、支援金は2026年4月分から（calculateChildSupportPayment が判定）
 */
export interface PremiumResult {
  healthGrade: number | null;
  pensionGrade: number | null;
  healthStandard: number;
  pensionStandard: number;
  health: { employee: number; employer: number };
  care: { employee: number; employer: number };
  pension: { employee: number; employer: number };
  childSupport: { employee: number; employer: number };
  employee: number;
  employer: number;
}

export function monthlyPremium(rates: AllRates, rule: RoundingRule, remuneration: number, age: number, ym: string): PremiumResult {
  if (!rates.health) throw new Error('健康保険料率がありません');
  const hg = lookupGrade(resolveGradeTable('health', rates.health.gradeTable), Math.max(0, remuneration));
  const pg = rates.pension ? lookupGrade(resolveGradeTable('pension', rates.pension.gradeTable), Math.max(0, remuneration)) : null;
  return premiumOn(rates, rule, hg.standardRemuneration, pg?.standardRemuneration ?? 0, age, ym, hg.gradeNumber, pg?.gradeNumber ?? null);
}

export function premiumOn(
  rates: AllRates, rule: RoundingRule, healthStandard: number, pensionStandard: number, age: number, ym: string,
  healthGrade: number | null = null, pensionGrade: number | null = null,
): PremiumResult {
  const split = (std: number, r: InsuranceRateDoc | null) => {
    if (!r || std <= 0) return { employee: 0, employer: 0 };
    const p = splitPremium(std, r.employeeRate, r.employerRate, rule, r.totalRate);
    return { employee: p.employeeAmount, employer: p.employerAmount };
  };
  const health = split(healthStandard, rates.health);
  const care = age >= 40 && age < 65 ? split(healthStandard, rates.longTermCare) : { employee: 0, employer: 0 };
  const pension = age < 70 ? split(pensionStandard, rates.pension) : { employee: 0, employer: 0 };
  const support = calculateChildSupportPayment(healthStandard, ym, age >= 75, rule, rates.childSupportPayment);
  const contribution = rates.childSupport && age < 70 && pensionStandard > 0 ? employerOnlyPremium(pensionStandard, rates.childSupport.employerRate).employerAmount : 0;
  const childSupport = { employee: support.employeeAmount, employer: support.employerAmount + contribution };
  return {
    healthGrade, pensionGrade: age < 70 ? pensionGrade : null, healthStandard, pensionStandard,
    health, care, pension, childSupport,
    employee: health.employee + care.employee + pension.employee + childSupport.employee,
    employer: health.employer + care.employer + pension.employer + childSupport.employer,
  };
}

/** 料率改定の試算用：料率（‰）を差し替えた料率一式。本人と会社は折半 */
export function withRates(rates: AllRates, next: { health?: number; longTermCare?: number; pension?: number }): AllRates {
  const swap = (r: InsuranceRateDoc | null, total?: number): InsuranceRateDoc | null =>
    r && typeof total === 'number' ? { ...r, totalRate: total, employeeRate: total / 2, employerRate: total / 2 } : r;
  return { ...rates, health: swap(rates.health, next.health), longTermCare: swap(rates.longTermCare, next.longTermCare), pension: swap(rates.pension, next.pension) };
}

/** 年齢（その月の末日時点の満年齢。社会保険の年齢到達は誕生日の前日） */
export function ageAt(birthDate: string, ym: string): number {
  const [by, bm, bd] = birthDate.split('-').map(Number);
  const [y, m] = ym.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0));
  const reach = (age: number) => { const d = new Date(Date.UTC(by + age, bm - 1, bd)); d.setUTCDate(d.getUTCDate() - 1); return d; };
  let age = y - by - 1;
  while (reach(age + 1) <= lastDay) age++;
  return Math.max(0, age);
}
