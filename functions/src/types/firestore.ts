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
  /** 扶養から外した理由 */
  disqualificationReason?: string | null;
  occupation?: string | null;
  /** 認定状況（扶養の手続きで届け出た人） */
  certification?: 'certified' | 'removed' | null;
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
  /** regular=定時決定、occasional=随時改定、initial=資格取得時決定、leaveEnd=産休・育休終了時改定、specific=その他 */
  determinationType: 'regular' | 'occasional' | 'initial' | 'leaveEnd' | 'specific';
  /** 決定の根拠となった報酬月額 */
  basisRemuneration?: number | null;
  basisMonths?: string[] | null;
  /** 決めたときの届出（資格取得届・月額変更届など） */
  filingId?: string | null;
  approvalRequestId?: string;
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
  /** 退職による閲覧専用の開始日（YYYY-MM-DD。この日から isSuspended と同じ扱い） */
  suspendFrom?: string | null;
  /** 退職後の閲覧期間が終わり、ログインを止める日（YYYY-MM-DD） */
  loginDisabledFrom?: string | null;
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
  /** 入社手続き（ウィザード）の状態。旧方式の入社手続きにはない */
  onboarding?: OnboardingState;
  /** 退職手続き（ウィザード）の状態。旧方式の退職手続きにはない */
  resignation?: ResignationState;
  /** 扶養の手続き（ウィザード）の状態。旧方式の扶養異動にはない */
  dependentChange?: DependentChangeState;
  /** 産休・育休の手続き（ウィザード）の状態。旧方式の休業手続きにはない */
  leaveProcedure?: LeaveProcedureState;
  /** 随時改定・産休育休終了時改定の手続き（ウィザード）の状態。旧方式の随時改定にはない */
  gradeRevision?: GradeRevisionState;
  /** 年齢到達（70歳・75歳）の手続き（ウィザード）の状態。旧方式の年齢到達にはない */
  ageEvent?: AgeEventState;
}

/** 年齢到達（70歳の厚生年金の喪失・75歳の健康保険の喪失）の手続き（ウィザード）の状態 */
export interface AgeEventState {
  kind: 'pension70' | 'health75';
  birthDate: string;
  /** 年齢に達する日（誕生日の前日） */
  reachDate: string;
  /** 資格を失う日（70歳は到達日、75歳は誕生日） */
  lossDate: string;
  /** 70歳：到達日の報酬月額（担当者が確かめた額）と現物の内訳 */
  remuneration: number | null;
  inKind: number;
  /** 70歳：届出が要るか（標準報酬月額相当額が到達前と違う）。確かめるまでは null */
  filingRequired: boolean | null;
  equivalentGrade: number | null;
  equivalentStandard: number | null;
  /** 75歳：保険証などの回収枚数 */
  cardsReturned: number;
  cardsUnreturnable: number;
  filingId: string | null;
}

/** 随時改定・終了時改定で、等級を改定すると決めたときの判定（届出と承認はこの値で作る） */
export interface GradeRevisionDecision {
  startMonth: string;
  effectiveMonth: string;
  months: { yearMonth: string; totalSalary: number; inKind: number; retroactive: number; remuneration: number; paymentBasisDays: number; used: boolean }[];
  total: number;
  average: number;
  averageWithRetro: number;
  direction: 'up' | 'down' | null;
  health: { eligible: boolean; currentGrade: number | null; currentStandard: number | null; newGrade: number | null; newStandard: number | null };
  pension: { eligible: boolean; currentGrade: number | null; currentStandard: number | null; newGrade: number | null; newStandard: number | null };
  decidedAt: Timestamp;
  decidedBy: string;
}

/** 随時改定・産休育休終了時改定の手続き（ウィザード）の状態 */
export interface GradeRevisionState {
  kind: 'occasional' | 'maternityEnd' | 'childcareEnd';
  /** 起点の月（随時改定は固定的賃金が変わった給与の支給月、終了時改定は休業を終えた日の翌日が属する月） */
  startMonth: string | null;
  /** 随時改定：前月の給与がなく比べられないときに担当者が選んだ固定的賃金の変動の向き */
  manualDirection: 'up' | 'down' | null;
  /** 上限・下限の特例で使う従前の報酬月額（担当者が入れた値） */
  previousRemuneration: number | null;
  /** 変動の理由（昇給・手当の新設など。届出の備考の参考） */
  note: string;
  /** 終了時改定：休業と本人の申出 */
  leave: {
    procedureId: string | null; endDate: string | null; childName: string; childBirthDate: string | null;
    nextLeaveFromNextDay: boolean; applied: boolean; appliedDate: string | null;
  } | null;
  decision: GradeRevisionDecision | null;
  filingId: string | null;
  /** 対象外として終えたときの理由 */
  closedReason: string | null;
}

/** 休業の期間（届け出た内容）。日付は YYYY-MM-DD */
export interface LeavePeriodState {
  startDate: string;
  /** 終了予定日（延長・出産日の変更で変わる） */
  plannedEnd: string;
  actualBirthDate: string | null;
  /** 休業を終えた日。終えるまでは null */
  actualEndDate: string | null;
}

/** 産休・育休の手続き（ウィザード）の状態。1つの休業につき1つの手続きで、休業中の変更届・終了届まで扱う */
export interface LeaveProcedureState {
  kind: 'maternity' | 'childcare';
  /** 産休：出産予定日と多胎か */
  expectedBirthDate: string | null;
  multiple: boolean;
  /** 育休：養育する子。本人が出産した子なら産後56日は育休を取れない */
  child: { lastName: string; firstName: string; birthDate: string; bornByEmployee: boolean } | null;
  /** 期間。入れるまでは null */
  period: LeavePeriodState | null;
  /** 今作っている（最後に作った）届出の種類と届出 */
  filingKind: 'start' | 'change' | 'extend' | 'end';
  filingId: string | null;
  /** 申出書（最初の届出）。免除はこの届出の承認で効く */
  startFilingId: string | null;
  /** 申出書を出したときに出産日が分かっていたか（出産後の申出なら出産日の変更届は要らない） */
  filedWithBirth: boolean;
  /** 休業中に記録したことで、まだ提出していない届出がある場合の、記録する前の期間（記録をやり直すときに戻す） */
  pending: {
    type: 'birth' | 'extend' | 'end'; date: string; before: LeavePeriodState;
    /** 記録する前の届出のステップと参照（記録をやり直すときに戻す） */
    steps: ProcedureStep[]; references: ProcedureReference[];
  } | null;
  /** 提出が済んだ届出の履歴 */
  history: { kind: 'start' | 'change' | 'extend' | 'end'; filingId: string; label: string; eventDate: string | null }[];
  /** 休業（leaves）と免除（premiumExemptions）。申出書を作ったときに作る */
  leaveId: string | null;
  exemptionId: string | null;
  /** 産休の手続きから続けて始めた育休の場合の、産休の手続き */
  sourceProcedureId: string | null;
}

/** 扶養の手続きで届け出る1人分の異動 */
export interface DependentChangeItem {
  kind: 'add' | 'remove' | 'change';
  /** 台帳の被扶養者。追加は完了時に作る */
  dependentId: string | null;
  /** 異動日（扶養に入れる日・外れる日・変わった日）YYYY-MM-DD */
  eventDate: string;
  lastName: string;
  firstName: string;
  lastNameKana: string;
  firstNameKana: string;
  birthDate: string;
  gender: 'male' | 'female';
  relationship: string;
  /** 年間収入の見込み（円） */
  income: number;
  coResident: boolean;
  occupation: string;
  isDisabled: boolean;
  /** 外す理由・変わった内容 */
  reason: string;
  /** 収入が基準以上でも扶養に入れる場合の理由 */
  exceptionReason: string;
}

export interface DependentChangeState {
  items: DependentChangeItem[];
  /** 入社の手続きから引き継いだ場合の、その手続き */
  sourceProcedureId: string | null;
  filingId: string | null;
  /** 台帳に反映した日時（完了時） */
  appliedAt: Timestamp | null;
}

/** 退職手続き（ウィザード）の状態 */
export interface ResignationState {
  /** 退職日（死亡の場合は死亡日）YYYY-MM-DD。入れるまでは null */
  resignationDate: string | null;
  reason: 'resignation' | 'death';
  /** 退職理由のメモ（自己都合・定年など。届出には載せない） */
  note: string;
  /** 台帳に退職を登録した日時 */
  appliedAt: Timestamp | null;
  /** 最後の保険料の集め方（決めたときの内容） */
  settlement: {
    /** 最後の給与の支給月。null は退職後に支給する給与がない（最後の給与は支給済み） */
    lastPayMonth: string | null;
    rows: { month: string; due: number; dueSource: string; collected: number; plan: string; payMonth: string | null }[];
    totals: { payroll: number; final: number; transfer: number; over: number };
    decidedAt: Timestamp;
    decidedBy: string;
  } | null;
  /** 資格喪失届に書く被保険者証の回収状況 */
  cards: { returned: number; unreturnable: number } | null;
  filingId: string | null;
  /** 退職後のポータル閲覧の最終日 YYYY-MM-DD */
  accessUntil: string | null;
}

/** 本人が招待リンクから入力した内容。台帳への登録は担当者が確かめてから行う */
export interface OnboardSelfInput {
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
  /** 扶養に入れたい家族（扶養の手続きは別に行う） */
  dependents: { lastName: string; firstName: string; relationship: string; birthDate: string | null }[];
}

export interface OnboardingState {
  /** 入社日（資格取得日）YYYY-MM-DD */
  hireDate: string;
  /** 手続きを始めたときに担当者が入れた氏名 */
  plannedName: string;
  email: string | null;
  inviteToken: string | null;
  inviteExpiresAt: Timestamp | null;
  /** 本人に依頼せず担当者が入力する */
  inviteSkipped: boolean;
  selfInput: OnboardSelfInput | null;
  selfInputAt: Timestamp | null;
  employmentId: string | null;
  /** 資格取得時の報酬月額に加える固定的な手当・現物給与（月額） */
  allowances: number;
  inKind: number;
  filingId: string | null;
  /** まとめて始めた入社のグループ */
  batchId: string | null;
  /** まとめて行う操作から外している理由（保留） */
  hold?: { reason: string; by: string; at: Timestamp } | null;
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
