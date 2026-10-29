import { Timestamp } from 'firebase-admin/firestore';

export interface EmployeeDoc {
  employeeNumber: string;
  lastName: string;
  firstName: string;
  lastNameKana: string;
  firstNameKana: string;
  birthDate: Timestamp;
  gender: 'male' | 'female';
  officeId: string;
  departmentId: string | null;
  hireDate: Timestamp;
  resignationDate: Timestamp | null;
  userId: string | null;
  isActive: boolean;
  version: number;
  deletedAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  // 以下はカタログ2章の台帳項目。旧データには存在しないため任意
  formerLastName?: string | null;
  postalCode?: string | null;
  prefecture?: string | null;
  city?: string | null;
  addressLine?: string | null;
  building?: string | null;
  phone?: string | null;
  email?: string | null;
  /** 被保険者整理番号 */
  insuredPersonNumber?: string | null;
  /** 資格取得年月日（YYYY-MM-DD）。未設定なら入社日 */
  qualificationAcquiredDate?: string | null;
  /** 資格喪失年月日（YYYY-MM-DD）。未設定なら退職日の翌日 */
  qualificationLostDate?: string | null;
  foreignInfo?: ForeignWorkerInfo | null;
}

export interface ForeignWorkerInfo {
  romanName: string;
  nationality: string;
  residenceStatus: string;
  residencePeriodEnd: string | null;
  residenceCardNumber: string | null;
  workPermission: boolean;
}

export interface DependentDoc {
  lastName: string;
  firstName: string;
  lastNameKana: string;
  firstNameKana: string;
  birthDate: Timestamp;
  gender: 'male' | 'female';
  relationship: string;
  isDisabled: boolean;
  income: number;
  coResident: boolean;
  qualificationDate: Timestamp;
  disqualificationDate: Timestamp | null;
  deletedAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface OfficeDoc {
  name: string;
  officeNumber: string;
  prefectureCode: string;
  insurerId: string;
  address: string;
  phone: string;
  closingDay: number;
  paymentDay: number;
  paymentMonth: 'current' | 'next';
  deductionMethod: 'current' | 'previous';
  roundingRule: 'statutory' | 'truncate' | 'round' | 'ceil';
  isActive: boolean;
  version: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  // 以下はカタログ1章の事業所項目。旧データには存在しないため任意
  postalCode?: string | null;
  /** 事業所番号（5桁） */
  officeCode?: string | null;
  /** 管轄年金事務所 */
  pensionOfficeName?: string | null;
  /** 適用年月日（YYYY-MM-DD） */
  appliedDate?: string | null;
  /** 賞与の支給予定月（1〜12） */
  bonusMonths?: number[];
  insuredNumberMode?: 'auto' | 'manual';
  /** 通常の労働者の週所定労働時間（適用判定の3/4基準）。未設定は40時間 */
  fullTimeWeeklyHours?: number | null;
  /** 通常の労働者の月所定労働日数（適用判定の3/4基準）。未設定は21日 */
  fullTimeMonthlyDays?: number | null;
}

export interface DepartmentDoc {
  name: string;
  parentId: string | null;
  officeId: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface InsuranceRateDoc {
  insuranceType: 'health' | 'pension' | 'childSupport' | 'childSupportPayment' | 'longTermCare';
  insurerId: string;
  prefectureCode: string;
  appliedFrom: string;
  appliedUntil: string | null;
  totalRate: number;
  employeeRate: number;
  employerRate: number;
  gradeTable: GradeTableEntry[] | null;
  note: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface GradeTableEntry {
  gradeNumber: number;
  standardRemuneration: number;
  lowerBound: number;
  upperBound: number;
}

export type EmploymentType = 'regular' | 'contract' | 'partTime' | 'arbeit' | 'executiveFull' | 'executivePart';

export interface EmploymentDoc {
  effectiveDate: string;
  employmentType: EmploymentType;
  weeklyHours: number;
  monthlyDays: number;
  baseSalary: number;
  /** 旧項目。新しいデータでは healthInsuranceEnrolled / pensionEnrolled を使う */
  socialInsuranceEnrolled: boolean;
  longTermCareEnrolled: boolean;
  note: string;
  version: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  // 以下はカタログ3章の項目。旧データには存在しないため任意（utils/employment.ts で既定値を補う）
  contractType?: 'indefinite' | 'fixed';
  contractStartDate?: string | null;
  contractEndDate?: string | null;
  renewalExpected?: boolean;
  weeklyDays?: number | null;
  workStyle?: 'fullTime' | 'partTime' | 'shortTime';
  probationStartDate?: string | null;
  probationEndDate?: string | null;
  wageType?: 'monthly' | 'daily' | 'hourly';
  /** 日給・時給の単価（月給は baseSalary） */
  wageAmount?: number | null;
  monthlyHours?: number | null;
  healthInsuranceEnrolled?: boolean;
  pensionEnrolled?: boolean;
  applicabilityReason?: 'standard' | 'specificShortTime' | 'excluded';
  insuredCategory?: 'general' | 'partTimer' | 'shortTime';
  isStudent?: boolean;
  /** システムの適用判定。担当者が異なる判断をした場合は override に理由を残す */
  applicabilityJudgement?: { result: 'applicable' | 'notApplicable' | 'manual'; reason: string } | null;
  applicabilityOverride?: { reason: string; by: string } | null;
}

export interface GradeDoc {
  effectiveMonth: string;
  healthGradeNumber: number;
  healthStandardRemuneration: number;
  pensionGradeNumber: number;
  pensionStandardRemuneration: number;
  determinationType: 'regular' | 'occasional' | 'initial' | 'specific';
  reason: string;
  version: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface SalaryDoc {
  yearMonth: string;
  officeId: string;
  paymentBasisDays: number;
  baseSalary: number;
  fixedAllowances: Record<string, number>;
  variableAllowances: Record<string, number>;
  totalFixedWage: number;
  totalVariableWage: number;
  totalSalary: number;
  isConfirmed: boolean;
  isPublished?: boolean;
  confirmedAt: Timestamp | null;
  confirmedBy: string | null;
  revisionFlag?: boolean;
  revisionDetectedAt?: Timestamp | null;
  previousTotalFixedWage?: number | null;
  /** 現物給与（社宅・食事など。担当者が金額を入力） */
  inKindAmount?: number;
  /** 遡及昇給の差額。実際の支給額には含まれ、等級の判定からは除く */
  retroactivePay?: { amount: number; fromMonth: string; toMonth: string } | null;
  version: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface BonusDoc {
  yearMonth: string;
  officeId: string;
  totalAmount: number;
  standardBonusAmount: number;
  cumulativeBonusAmount: number;
  isConfirmed: boolean;
  confirmedAt: Timestamp | null;
  confirmedBy: string | null;
  version: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface InsurancePremiumBreakdown {
  employeeAmount: number;
  employerAmount: number;
}

export interface MonthlyInsuranceDoc {
  yearMonth: string;
  officeId: string;
  healthGradeNumber: number;
  healthStandardRemuneration: number;
  pensionGradeNumber: number;
  pensionStandardRemuneration: number;
  healthInsurance: InsurancePremiumBreakdown;
  longTermCareInsurance: InsurancePremiumBreakdown | null;
  pensionInsurance: InsurancePremiumBreakdown;
  childSupportContribution: InsurancePremiumBreakdown;
  childSupportPayment?: InsurancePremiumBreakdown;
  totalEmployeeAmount: number;
  totalEmployerAmount: number;
  isExempted: boolean;
  isConfirmed: boolean;
  version: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface BonusInsuranceDoc {
  yearMonth: string;
  officeId: string;
  healthCappedAmount: number;
  pensionCappedAmount: number;
  healthInsurance: InsurancePremiumBreakdown;
  longTermCareInsurance: InsurancePremiumBreakdown | null;
  pensionInsurance: InsurancePremiumBreakdown;
  childSupportContribution: InsurancePremiumBreakdown;
  childSupportPayment?: InsurancePremiumBreakdown;
  totalEmployeeAmount: number;
  totalEmployerAmount: number;
  isExempted: boolean;
  isConfirmed: boolean;
  version: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface FilingDoc {
  filingType: string;
  workflowStatus: 'draft' | 'pending' | 'approved' | 'rejected';
  mockStatus: 'notStarted' | 'processing' | 'completed' | 'failed';
  submissionStatus: 'notSubmitted' | 'submitted' | 'accepted' | 'returned';
  effectiveDate: string;
  formData: Record<string, unknown>;
  submittedAt: Timestamp | null;
  resultReceivedAt: Timestamp | null;
  resultNote: string | null;
  version: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ApprovalRequestDoc {
  targetPath: string;
  targetVersion: number;
  snapshotData: Record<string, unknown>;
  requestType: 'salary' | 'bonus' | 'monthlyInsurance' | 'bonusInsurance' | 'filing' | 'employment' | 'grade';
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  requestedBy: string;
  requestedAt: Timestamp;
  reviewedBy: string | null;
  reviewedAt: Timestamp | null;
  comment: string | null;
  isDeferred?: boolean;
  metadata?: Record<string, unknown>;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface UserDoc {
  email: string;
  displayName: string;
  roles: ('admin' | 'approver' | 'operator' | 'viewer' | 'employee')[];
  officeIds: string[];
  employeeId: string | null;
  isSuspended: boolean;
  isLoginDisabled: boolean;
  lastLoginAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface InvitationDoc {
  email: string;
  roles: ('admin' | 'approver' | 'operator' | 'viewer' | 'employee')[];
  officeIds: string[];
  employeeId: string | null;
  status: 'pending' | 'accepted' | 'expired';
  invitedBy: string;
  expiresAt: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// --- 案件（Procedure）---

export type ProcedureType =
  | 'acquisition'
  | 'loss'
  | 'dependent_change'
  | 'maternity_leave'
  | 'childcare_leave'
  | 'monthly_change'
  | 'annual_review'
  | 'bonus_payment'
  | 'transfer'
  | 'age_event';

export type ProcedureStatus = 'draft' | 'in_progress' | 'completed' | 'cancelled';

export type ProcedureScope = 'individual' | 'batch';

export type StepType =
  | 'data_entry'
  | 'document_create'
  | 'approval'
  | 'mock_filing'
  | 'paper_submit'
  | 'notification'
  | 'calculation'
  | 'account_control'
  | 'confirmation';

export type StepStatus =
  | 'blocked'
  | 'available'
  | 'in_progress'
  | 'completed'
  | 'skipped'
  | 'returned';

export interface ProcedureStep {
  id: string;
  label: string;
  type: StepType;
  dependsOn: string[];
  isConditional: boolean;
  condition: string | null;
  status: StepStatus;
  statusDetail: string | null;
  referenceType: string | null;
  referenceId: string | null;
  referenceStatus: string | null;
  actionLabel: string | null;
  actionRoute: string | null;
  completedAt: Timestamp | null;
  completedBy: string | null;
}

export interface ProcedureReference {
  type: 'filing' | 'approval' | 'salary' | 'leave' | 'exemption' | 'employee' | 'grade' | 'collection';
  documentId: string;
  employeeId: string | null;
  documentSubtype: string | null;
  stepId: string;
  createdAt: Timestamp;
}

export interface ProcedureBatchMeta {
  targetYearMonth: string;
  targetEmployeeIds: string[];
  processedCount: number;
  totalCount: number;
}

export interface ProcedureDoc {
  procedureType: ProcedureType;
  title: string;
  priority: 'high' | 'normal' | 'low';
  status: ProcedureStatus;
  statusReason: string;
  employeeId: string | null;
  employeeName: string;
  officeId: string;
  targetOfficeId: string | null;
  scope: ProcedureScope;
  batchMeta: ProcedureBatchMeta | null;
  invitationId: string | null;
  onboardToken: string | null;
  steps: ProcedureStep[];
  deadline: Timestamp | null;
  effectiveDate: Timestamp | null;
  assignedTo: string;
  createdBy: string;
  references: ProcedureReference[];
  notes: string;
  version: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  completedAt: Timestamp | null;
  deletedAt: Timestamp | null;
}

export interface AuditLogDoc {
  entity: 'employee' | 'dependent' | 'approvalRequest' | 'user' | 'invitation';
  entityId: string;
  action: 'create' | 'update' | 'delete' | 'transfer' | 'resign' | 'approve' | 'reject' | 'invite';
  changes: Record<string, { from: unknown; to: unknown }>;
  performedBy: string;
  performedAt: Timestamp;
  version: number;
}
