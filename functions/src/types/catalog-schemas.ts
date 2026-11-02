import { z } from 'zod';

// カタログで追加になった項目の入力スキーマ。旧画面からの入力と互換を保つため、すべて任意

export const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, '有効な日付を入力してください');

const optionalText = (max: number) => z.string().max(max).nullable().optional();

export const ForeignWorkerInfoSchema = z.object({
  romanName: z.string().min(1).max(100),
  nationality: z.string().min(1).max(50),
  residenceStatus: z.string().min(1).max(50),
  residencePeriodEnd: calendarDate.nullable().default(null),
  residenceCardNumber: z.string().regex(/^[A-Z]{2}\d{8}[A-Z]{2}$/, '在留カード番号の形式が正しくありません').nullable().default(null),
  workPermission: z.boolean().default(false),
});

/** 従業員台帳の追加項目（2章） */
export const EmployeeProfileFields = {
  formerLastName: optionalText(50),
  postalCode: z.string().regex(/^\d{3}-?\d{4}$/, '郵便番号の形式が正しくありません').nullable().optional(),
  prefecture: optionalText(10),
  city: optionalText(100),
  addressLine: optionalText(200),
  building: optionalText(200),
  phone: z.string().regex(/^[0-9-]{10,13}$/, '電話番号の形式が正しくありません').nullable().optional(),
  email: z.string().email().nullable().optional(),
  insuredPersonNumber: optionalText(10),
  /** 基礎年金番号（10桁。個人番号がないときに届出に書く） */
  basicPensionNumber: z.string().regex(/^\d{4}-?\d{6}$/, '基礎年金番号は10桁の数字です').nullable().optional(),
  qualificationAcquiredDate: calendarDate.nullable().optional(),
  qualificationLostDate: calendarDate.nullable().optional(),
  foreignInfo: ForeignWorkerInfoSchema.nullable().optional(),
};

export const EMPLOYEE_PROFILE_KEYS = Object.keys(EmployeeProfileFields) as (keyof typeof EmployeeProfileFields)[];

export const EmploymentTypeSchema = z.enum(['regular', 'contract', 'partTime', 'arbeit', 'executiveFull', 'executivePart']);

/** 雇用・保険条件の追加項目（3章） */
export const EmploymentConditionFields = {
  contractType: z.enum(['indefinite', 'fixed']).optional(),
  contractStartDate: calendarDate.nullable().optional(),
  contractEndDate: calendarDate.nullable().optional(),
  renewalExpected: z.boolean().optional(),
  weeklyDays: z.number().min(0).max(7).nullable().optional(),
  workStyle: z.enum(['fullTime', 'partTime', 'shortTime']).optional(),
  probationStartDate: calendarDate.nullable().optional(),
  probationEndDate: calendarDate.nullable().optional(),
  wageType: z.enum(['monthly', 'daily', 'hourly']).optional(),
  wageAmount: z.number().int().min(0).nullable().optional(),
  monthlyHours: z.number().min(0).max(744).nullable().optional(),
  healthInsuranceEnrolled: z.boolean().optional(),
  pensionEnrolled: z.boolean().optional(),
  isStudent: z.boolean().optional(),
  /** システムの判定と異なる加入区分にする場合の理由 */
  overrideReason: z.string().min(1).max(500).optional(),
};

/** 給与の追加項目（4章） */
export const SalaryExtraFields = {
  inKindAmount: z.number().int().min(0).optional(),
  retroactivePay: z.object({
    amount: z.number().int().min(0),
    fromMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    toMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  }).refine(v => v.fromMonth <= v.toMonth, '差額の対象期間を確認してください').nullable().optional(),
};

/** 事業所の追加項目（1章） */
export const OfficeExtraFields = {
  postalCode: z.string().regex(/^\d{3}-?\d{4}$/).nullable().optional(),
  officeCode: z.string().regex(/^\d{5}$/, '事業所番号は5桁の数字です').nullable().optional(),
  pensionOfficeName: optionalText(100),
  appliedDate: calendarDate.nullable().optional(),
  bonusMonths: z.array(z.number().int().min(1).max(12)).max(12).optional(),
  insuredNumberMode: z.enum(['auto', 'manual']).optional(),
  fullTimeWeeklyHours: z.number().min(1).max(60).nullable().optional(),
  fullTimeMonthlyDays: z.number().min(1).max(31).nullable().optional(),
  healthInsuranceType: z.enum(['kyokai', 'union']).nullable().optional(),
};

export const OFFICE_EXTRA_KEYS = Object.keys(OfficeExtraFields) as (keyof typeof OfficeExtraFields)[];

export const RoundingRuleSchema = z.enum(['statutory', 'truncate', 'round', 'ceil']);

/** 入力のうち指定キーで値が指定されたもの（undefined 以外）だけを取り出す */
export function pickDefined<T extends object>(input: T, keys: readonly string[]): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of keys) {
    const value = (input as Record<string, unknown>)[key];
    if (value !== undefined) picked[key] = value;
  }
  return picked;
}

export const pickProfile = (input: object) => pickDefined(input, EMPLOYEE_PROFILE_KEYS);
