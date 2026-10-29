import { EmploymentDoc, EmployeeDoc } from '../types/firestore';
import { InsuredCategory } from '../insurance/calculator/payment-basis';
import { lossDateFromResignation } from '../insurance/calculator/coverage';

/** 旧データの雇用条件に既定値を補った形 */
export interface NormalizedEmployment {
  employmentType: EmploymentDoc['employmentType'];
  wageType: 'monthly' | 'daily' | 'hourly';
  healthInsuranceEnrolled: boolean;
  pensionEnrolled: boolean;
  insuredCategory: InsuredCategory;
  contractType: 'indefinite' | 'fixed';
}

export function normalizeEmployment(doc: EmploymentDoc): NormalizedEmployment {
  const legacyEnrolled = doc.socialInsuranceEnrolled !== false;
  const partTime = doc.employmentType === 'partTime' || doc.employmentType === 'arbeit' || doc.workStyle === 'partTime';
  const insuredCategory: InsuredCategory = doc.insuredCategory
    ?? (doc.applicabilityReason === 'specificShortTime' || doc.workStyle === 'shortTime' ? 'shortTime' : partTime ? 'partTimer' : 'general');
  return {
    employmentType: doc.employmentType,
    wageType: doc.wageType ?? 'monthly',
    healthInsuranceEnrolled: doc.healthInsuranceEnrolled ?? legacyEnrolled,
    pensionEnrolled: doc.pensionEnrolled ?? legacyEnrolled,
    insuredCategory,
    contractType: doc.contractType ?? 'indefinite',
  };
}

/** Timestamp または 'YYYY-MM-DD' を 'YYYY-MM-DD' にする（日本時間の日付） */
export function toDateString(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const date = typeof (value as { toDate?: () => Date }).toDate === 'function'
    ? (value as { toDate: () => Date }).toDate()
    : value instanceof Date ? value : null;
  if (!date) return null;
  return new Date(date.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

/** 資格取得日と資格喪失日（未登録なら入社日・退職日の翌日から補う） */
export function qualificationDates(employee: EmployeeDoc): { acquisitionDate: string | null; lossDate: string | null } {
  const acquisitionDate = employee.qualificationAcquiredDate ?? toDateString(employee.hireDate);
  const resignation = toDateString(employee.resignationDate);
  const lossDate = employee.qualificationLostDate ?? (resignation ? lossDateFromResignation(resignation) : null);
  return { acquisitionDate, lossDate };
}
