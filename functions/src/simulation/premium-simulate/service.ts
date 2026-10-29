import { db } from '../../config';
import { AuthContext } from '../../middleware/auth';
import { InsuranceRateDoc, GradeTableEntry, OfficeDoc } from '../../types/firestore';
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
  totalEmployee: number;
  totalEmployer: number;
  totalCompany: number;
}

function findGrade(table: GradeTableEntry[], remuneration: number): GradeTableEntry {
  for (const entry of table) {
    if (remuneration >= entry.lowerBound && remuneration < entry.upperBound) return entry;
  }
  return table[table.length - 1];
}

function roundPremium(amount: number, rule: string): number {
  if (rule === 'truncate') return Math.floor(amount);
  if (rule === 'ceil') return Math.ceil(amount);
  return Math.round(amount);
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

  const ratesSnap = await db
    .collection(`${base}/insuranceRates`)
    .where('insurerId', '==', office.insurerId)
    .where('appliedFrom', '<=', ym)
    .get();

  const activeRates = ratesSnap.docs
    .map((d) => d.data() as InsuranceRateDoc)
    .filter((r) => !r.appliedUntil || r.appliedUntil >= ym);

  const findRate = (type: string) => activeRates.find((r) => r.insuranceType === type);

  const healthRate = findRate('health');
  const pensionRate = findRate('pension');
  const longTermCareRate = findRate('longTermCare');
  const childSupportRate = findRate('childSupport');
  const rule = office.roundingRule;

  if (!healthRate?.gradeTable) throw notFound('健康保険料率');

  const healthGrade = findGrade(healthRate.gradeTable, input.monthlyRemuneration);
  const healthEmployee = roundPremium(healthGrade.standardRemuneration * healthRate.employeeRate / 1000, rule);
  const healthEmployer = roundPremium(healthGrade.standardRemuneration * healthRate.employerRate / 1000, rule);

  let longTermCare: SimulationBreakdown | null = null;
  if (input.age >= 40 && input.age < 65 && longTermCareRate) {
    const ltcEmployee = roundPremium(healthGrade.standardRemuneration * longTermCareRate.employeeRate / 1000, rule);
    const ltcEmployer = roundPremium(healthGrade.standardRemuneration * longTermCareRate.employerRate / 1000, rule);
    longTermCare = {
      gradeNumber: healthGrade.gradeNumber,
      standardRemuneration: healthGrade.standardRemuneration,
      rate: longTermCareRate.totalRate,
      employeeAmount: ltcEmployee,
      employerAmount: ltcEmployer,
    };
  }

  let pension: SimulationBreakdown | null = null;
  if (input.age < 70 && pensionRate?.gradeTable) {
    const pensionGrade = findGrade(pensionRate.gradeTable, input.monthlyRemuneration);
    const penEmployee = roundPremium(pensionGrade.standardRemuneration * pensionRate.employeeRate / 1000, rule);
    const penEmployer = roundPremium(pensionGrade.standardRemuneration * pensionRate.employerRate / 1000, rule);
    pension = {
      gradeNumber: pensionGrade.gradeNumber,
      standardRemuneration: pensionGrade.standardRemuneration,
      rate: pensionRate.totalRate,
      employeeAmount: penEmployee,
      employerAmount: penEmployer,
    };
  }

  const childEmployer = childSupportRate
    ? roundPremium((pension?.standardRemuneration ?? 0) * childSupportRate.employerRate / 1000, rule)
    : 0;

  const totalEmployee = healthEmployee + (longTermCare?.employeeAmount ?? 0) + (pension?.employeeAmount ?? 0);
  const totalEmployer = healthEmployer + (longTermCare?.employerAmount ?? 0) + (pension?.employerAmount ?? 0) + childEmployer;

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
    totalEmployee,
    totalEmployer,
    totalCompany: totalEmployee + totalEmployer,
  };
}
