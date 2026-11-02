import { z } from 'zod';
import { calendarDate, EmployeeProfileFields, EmploymentConditionFields, EmploymentTypeSchema } from '../types/catalog-schemas';

const id = z.string().min(1).regex(/^[^/]+$/);

const Person = z.object({
  lastName: z.string().min(1).max(50),
  firstName: z.string().min(1).max(50),
  email: z.string().email().nullable().optional(),
});

/** 入社手続きを始める。people が複数なら新卒一斉入社などのまとめての開始 */
export const OnboardingStartSchema = z.object({
  companyId: id,
  officeId: id,
  hireDate: calendarDate,
  people: z.array(Person).min(1).max(500),
  /** 本人に入力を依頼せず、担当者が入力する */
  skipInvite: z.boolean().default(false),
});

export const OnboardingGetSchema = z.object({
  companyId: id,
  procedureId: id,
});

export const OnboardingListSchema = z.object({
  companyId: id,
  officeId: id.optional(),
  batchId: id.optional(),
  /** 入社日のまとめの人だけ */
  hireDate: calendarDate.optional(),
  includeCompleted: z.boolean().default(false),
});

const Dependent = z.object({
  lastName: z.string().min(1).max(50),
  firstName: z.string().min(1).max(50),
  relationship: z.enum(['spouse', 'child', 'parent', 'other']),
  birthDate: calendarDate.nullable().default(null),
});

const kana = z.string().min(1).max(50).regex(/^[ァ-ヶー\s　]+$/, 'フリガナはカタカナで入力してください');

/** 本人の入力（招待リンクから）。担当者が代わりに入力するときも同じ項目を使う */
export const SelfInputSchema = z.object({
  lastName: z.string().min(1).max(50),
  firstName: z.string().min(1).max(50),
  lastNameKana: kana,
  firstNameKana: kana,
  birthDate: calendarDate,
  gender: z.enum(['male', 'female']),
  postalCode: EmployeeProfileFields.postalCode.default(null),
  prefecture: z.string().max(10).nullable().default(null),
  city: z.string().max(100).nullable().default(null),
  addressLine: z.string().max(200).nullable().default(null),
  building: z.string().max(200).nullable().default(null),
  phone: EmployeeProfileFields.phone.default(null),
  email: z.string().email().nullable().default(null),
  dependents: z.array(Dependent).max(20).default([]),
});

export const InviteGetSchema = z.object({ token: z.string().min(20).max(100) });
export const InviteSubmitSchema = z.object({ token: z.string().min(20).max(100), data: SelfInputSchema });

const Base = { companyId: id, procedureId: id, expectedVersion: z.number().int().min(1) };

/** 本人に依頼せず担当者が入力する／招待リンクを作り直す */
export const InviteActionSchema = z.object({ ...Base, action: z.enum(['skip', 'reissue']) });

/** 本人の入力を確かめて台帳に登録する。担当者が直した内容で登録する */
export const RegisterSchema = z.object({
  ...Base,
  employeeNumber: z.string().min(1).max(20),
  departmentId: z.string().nullable().optional(),
  insuredPersonNumber: EmployeeProfileFields.insuredPersonNumber,
  profile: SelfInputSchema,
});

/** 雇用条件。加入の判定と資格取得時の報酬月額に使う */
export const ContractFields = {
  employmentType: EmploymentTypeSchema,
  weeklyHours: z.number().min(0).max(168),
  monthlyDays: z.number().min(0).max(31),
  wageType: z.enum(['monthly', 'daily', 'hourly']),
  /** 月給・日給・時給の額 */
  wageAmount: z.number().int().min(0),
  monthlyHours: z.number().min(0).max(744).nullable().default(null),
  /** 固定的な手当（通勤手当を含む）の月額 */
  allowances: z.number().int().min(0).default(0),
  /** 現物給与の月額 */
  inKind: z.number().int().min(0).default(0),
  contractType: z.enum(['indefinite', 'fixed']).default('indefinite'),
  contractEndDate: EmploymentConditionFields.contractEndDate,
  renewalExpected: z.boolean().default(false),
  /** 試用期間（保険料・届出には使わない管理項目） */
  probationStartDate: EmploymentConditionFields.probationStartDate,
  probationEndDate: EmploymentConditionFields.probationEndDate,
  isStudent: z.boolean().default(false),
  /** システムの判定と異なる加入区分にする場合だけ指定する */
  // 呼び出し時に undefined は null になるため、null も「指定なし」として受ける
  healthInsuranceEnrolled: z.boolean().nullish().transform(v => v ?? undefined),
  pensionEnrolled: z.boolean().nullish().transform(v => v ?? undefined),
  overrideReason: z.string().min(1).max(500).nullish().transform(v => v ?? undefined),
};

export const PreviewSchema = z.object({ companyId: id, procedureId: id, ...ContractFields });
export const ContractSchema = z.object({ ...Base, ...ContractFields });
export const SubmitFilingSchema = z.object({ ...Base });
export const CompleteSchema = z.object({ ...Base });
/** 保留にする（reason が null なら解除） */
export const HoldSchema = z.object({ ...Base, reason: z.string().min(1).max(200).nullable() });

export type OnboardingStartInput = z.output<typeof OnboardingStartSchema>;
export type SelfInput = z.output<typeof SelfInputSchema>;
export type ContractInput = z.output<typeof PreviewSchema>;
export type RegisterInput = z.output<typeof RegisterSchema>;
