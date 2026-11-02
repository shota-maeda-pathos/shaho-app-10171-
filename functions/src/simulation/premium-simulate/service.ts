import { db } from '../../config';
import { AuthContext } from '../../middleware/auth';
import { OfficeDoc } from '../../types/firestore';
import { findAllRates } from '../../utils/insurance-rate';
import { calculateChildSupportPayment } from '../../utils/child-support-payment';
import { employerOnlyPremium, lookupGrade, normalizeRoundingRule, resolveGradeTable, splitPremium } from '../../insurance/calculator';
import { notFound } from '../../utils/errors';
import { PremiumSimulateInput } from './schema';

export interface SimulationBreakdown {
  gradeNumber: number;
  standardRemuneration: number;
  rate: number;
  employeeAmount: number;
  employerAmount: number;
}

export interface PremiumSimulateResponse {
  yearMonth: string;
  monthlyRemuneration: number;
  age: number;
  health: SimulationBreakdown;
  longTermCare: SimulationBreakdown | null;
  pension: SimulationBreakdown | null;
  childSupport: { rate: number; employerAmount: number };
  /** 子ども・子育て支援金（2026年4月分から） */
  childSupportPayment: { employeeAmount: number; employerAmount: number };
  totalEmployee: number;
  totalEmployer: number;
  totalCompany: number;
}

export async function simulatePremium(
  input: PremiumSimulateInput,
  auth: AuthContext,
): Promise<PremiumSimulateResponse> {
  const base = `companies/${auth.companyId}`;
  const now = new Date();
  const ym = input.yearMonth ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const officeSnap = await db.doc(`${base}/offices/${input.officeId}`).get();
  if (!officeSnap.exists) throw notFound('事業所');
  const office = officeSnap.data()! as OfficeDoc;

  // 本処理と同じ料率検索・等級表・端数処理を使う
  const rates = await findAllRates(auth.companyId, ym, office.prefectureCode, office.insurerId, office.healthInsuranceType);
  const healthRate = rates.health;
  const pensionRate = rates.pension;
  const longTermCareRate = rates.longTermCare;
  const childSupportRate = rates.childSupport;
  const rule = normalizeRoundingRule(office.roundingRule);

  if (!healthRate) throw notFound('健康保険料率');

  const healthGrade = lookupGrade(resolveGradeTable('health', healthRate.gradeTable), input.monthlyRemuneration);
  const health = splitPremium(healthGrade.standardRemuneration, healthRate.employeeRate, healthRate.employerRate, rule, healthRate.totalRate);
  const healthEmployee = health.employeeAmount;
  const healthEmployer = health.employerAmount;

  let longTermCare: SimulationBreakdown | null = null;
  if (input.age >= 40 && input.age < 65 && longTermCareRate) {
    const ltc = splitPremium(healthGrade.standardRemuneration, longTermCareRate.employeeRate, longTermCareRate.employerRate, rule, longTermCareRate.totalRate);
    longTermCare = {
      gradeNumber: healthGrade.gradeNumber,
      standardRemuneration: healthGrade.standardRemuneration,
      rate: longTermCareRate.totalRate,
      ...ltc,
    };
  }

  let pension: SimulationBreakdown | null = null;
  if (input.age < 70 && pensionRate) {
    const pensionGrade = lookupGrade(resolveGradeTable('pension', pensionRate.gradeTable), input.monthlyRemuneration);
    pension = {
      gradeNumber: pensionGrade.gradeNumber,
      standardRemuneration: pensionGrade.standardRemuneration,
      rate: pensionRate.totalRate,
      ...splitPremium(pensionGrade.standardRemuneration, pensionRate.employeeRate, pensionRate.employerRate, rule, pensionRate.totalRate),
    };
  }

  const support = calculateChildSupportPayment(healthGrade.standardRemuneration, ym, input.age >= 75, rule, rates.childSupportPayment);
  const childEmployer = childSupportRate && pension
    ? employerOnlyPremium(pension.standardRemuneration, childSupportRate.employerRate).employerAmount
    : 0;

  const totalEmployee = healthEmployee + (longTermCare?.employeeAmount ?? 0) + (pension?.employeeAmount ?? 0) + support.employeeAmount;
  const totalEmployer = healthEmployer + (longTermCare?.employerAmount ?? 0) + (pension?.employerAmount ?? 0) + childEmployer + support.employerAmount;

  return {
    yearMonth: ym,
    monthlyRemuneration: input.monthlyRemuneration,
    age: input.age,
    health: {
      gradeNumber: healthGrade.gradeNumber,
      standardRemuneration: healthGrade.standardRemuneration,
      rate: healthRate.totalRate,
      employeeAmount: healthEmployee,
      employerAmount: healthEmployer,
    },
    longTermCare,
    pension,
    childSupport: { rate: childSupportRate?.totalRate ?? 0, employerAmount: childEmployer },
    childSupportPayment: support,
    totalEmployee,
    totalEmployer,
    totalCompany: totalEmployee + totalEmployer,
  };
}
