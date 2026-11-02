/** サーバー（functions/src/onboarding）の戻り値に合わせた型 */

export type WizardKey = 'invite' | 'register' | 'contract' | 'filing' | 'approval' | 'submit' | 'confirm' | 'done';
export type EmploymentType = 'regular' | 'contract' | 'partTime' | 'arbeit' | 'executiveFull' | 'executivePart';

export interface SelfInput {
  lastName: string;
  firstName: string;
  lastNameKana: string;
  firstNameKana: string;
  birthDate: string;
  gender: 'male' | 'female';
  postalCode: string | null;
  prefecture: string | null;
  city: string | null;
  addressLine: string | null;
  building: string | null;
  phone: string | null;
  email: string | null;
  dependents: { lastName: string; firstName: string; relationship: string; birthDate: string | null }[];
}

export interface ContractForm {
  employmentType: EmploymentType;
  weeklyHours: number;
  monthlyDays: number;
  wageType: 'monthly' | 'daily' | 'hourly';
  wageAmount: number;
  monthlyHours: number | null;
  allowances: number;
  inKind: number;
  contractType: 'indefinite' | 'fixed';
  contractEndDate: string | null;
  renewalExpected: boolean;
  /** 試用期間（任意） */
  probationStartDate?: string | null;
  probationEndDate?: string | null;
  isStudent: boolean;
  healthInsuranceEnrolled?: boolean;
  pensionEnrolled?: boolean;
  overrideReason?: string;
}

export interface Evaluation {
  judgement: { result: 'applicable' | 'notApplicable' | 'manual'; reason: string; insuredCategory: string | null };
  ageNotes: string[];
  expected: { health: boolean; pension: boolean };
  chosen: { health: boolean; pension: boolean };
  longTermCare: boolean;
  needsReason: boolean;
  monthlyHours: number | null;
  remuneration: number;
  healthGrade: { gradeNumber: number; standardRemuneration: number };
  pensionGrade: { gradeNumber: number; standardRemuneration: number };
}

export interface OnboardingView {
  procedure: {
    id: string; version: number; status: string; title: string; officeId: string; officeName: string;
    hireDate: string; deadline: string; plannedName: string; employeeName: string; batchId: string | null;
  };
  current: WizardKey;
  steps: { id: string; label: string; status: string; statusDetail: string | null }[];
  invite: { token: string | null; expiresAt: string | null; skipped: boolean; submittedAt: string | null; email: string | null };
  selfInput: SelfInput | null;
  employee: { id: string; employeeNumber: string; name: string; birthDate: string | null } | null;
  contract: ContractForm | null;
  evaluation: Evaluation | null;
  applicabilityOverride: { reason: string } | null;
  filing: { id: string; version: number; workflowStatus: string; mockStatus: string; submissionStatus: string; resultNote: string | null } | null;
  approval: { status: string; comment: string | null } | null;
}

export interface OnboardingListItem {
  id: string; version: number; status: string; name: string; officeId: string; hireDate: string;
  batchId: string | null; current: WizardKey; currentDetail: string | null; inviteToken: string | null;
  hold: { reason: string } | null;
  selfInputAt: string | null; createdAt: string;
}

export const EMPLOYMENT_TYPES: { value: EmploymentType; label: string }[] = [
  { value: 'regular', label: '正社員' },
  { value: 'contract', label: '契約社員' },
  { value: 'partTime', label: 'パートタイマー' },
  { value: 'arbeit', label: 'アルバイト' },
  { value: 'executiveFull', label: '役員（常勤）' },
  { value: 'executivePart', label: '役員（非常勤）' },
];

export const RELATIONSHIPS: Record<string, string> = { spouse: '配偶者', child: '子', parent: '父母', other: 'その他' };

/** 一覧などで出す「いまやること」 */
export const CURRENT_LABELS: Record<WizardKey, string> = {
  invite: '本人の入力待ち',
  register: '台帳に登録する',
  contract: '雇用条件を入れる',
  filing: '資格取得届を作る',
  approval: '承認者の確認待ち',
  submit: '提出する',
  confirm: '完了を確認する',
  done: '完了',
};

/** ウィザードのステップの順（完了を除く） */
export const ONBOARDING_KEYS: Exclude<WizardKey, 'done'>[] = ['invite', 'register', 'contract', 'filing', 'approval', 'submit', 'confirm'];

/** 横並びのステップに出す短い名前（1人の画面とまとめの画面で同じにする） */
export const STEP_LABELS: Record<Exclude<WizardKey, 'done'>, string> = {
  invite: '入力依頼',
  register: '本人情報',
  contract: '雇用条件',
  filing: '届出の作成',
  approval: '承認',
  submit: '提出',
  confirm: '完了の確認',
};

export function inviteUrl(token: string) {
  return `${location.origin}/onboard/${token}`;
}

export function errorMessage(e: unknown, fallback: string) {
  return e instanceof Error && e.message ? e.message : fallback;
}
