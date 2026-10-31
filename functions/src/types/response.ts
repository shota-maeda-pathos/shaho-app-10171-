export interface EmployeeResponse {
  id: string;
  employeeNumber: string;
  lastName: string;
  firstName: string;
  lastNameKana: string;
  firstNameKana: string;
  birthDate: string;
  gender: 'male' | 'female';
  officeId: string;
  officeName?: string;
  departmentId: string | null;
  departmentName?: string | null;
  hireDate: string;
  resignationDate: string | null;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  contract?: { type: 'indefinite' | 'fixed'; endDate: string | null; renewalExpected: boolean } | null;
  otherEmployer?: { name: string; since: string | null; note: string } | null;
}

export interface DependentResponse {
  id: string;
  employeeId: string;
  lastName: string;
  firstName: string;
  lastNameKana: string;
  firstNameKana: string;
  birthDate: string;
  gender: 'male' | 'female';
  relationship: string;
  isDisabled: boolean;
  income: number;
  coResident: boolean;
  qualificationDate: string;
  disqualificationDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OfficeResponse {
  id: string;
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
  /** 賞与の支給予定月（不支給報告書の判定に使う） */
  bonusMonths: number[];
  isActive: boolean;
  /** 健康保険の区分（未設定は協会けんぽ） */
  healthInsuranceType: 'kyokai' | 'union';
  pensionOfficeName: string | null;
  officeCode: string | null;
  /** 廃止した日（廃止していなければ null） */
  abolishedOn: string | null;
  /** 配属できない理由（設定が足りない項目）。空なら配属できる */
  setupIssues: string[];
  /** 更新時の expectedVersion に使う */
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface DepartmentResponse {
  id: string;
  name: string;
  parentId: string | null;
  officeId: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InsuranceRateResponse {
  id: string;
  insuranceType: 'health' | 'pension' | 'childSupport' | 'childSupportPayment' | 'longTermCare';
  insurerId: string;
  prefectureCode: string;
  appliedFrom: string;
  appliedUntil: string | null;
  totalRate: number;
  employeeRate: number;
  employerRate: number;
  gradeTable: { gradeNumber: number; standardRemuneration: number; lowerBound: number; upperBound: number }[] | null;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface EmploymentResponse {
  id: string;
  employeeId: string;
  effectiveDate: string;
  employmentType: import('./firestore').EmploymentType;
  weeklyHours: number;
  monthlyDays: number;
  baseSalary: number;
  socialInsuranceEnrolled: boolean;
  longTermCareEnrolled: boolean;
  note: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface GradeResponse {
  id: string;
  employeeId: string;
  effectiveMonth: string;
  healthGradeNumber: number;
  healthStandardRemuneration: number;
  pensionGradeNumber: number;
  pensionStandardRemuneration: number;
  determinationType: 'regular' | 'occasional' | 'initial' | 'specific';
  reason: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface SalaryResponse {
  id: string;
  employeeId: string;
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
  confirmedAt: string | null;
  confirmedBy: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface BonusResponse {
  id: string;
  employeeId: string;
  yearMonth: string;
  officeId: string;
  totalAmount: number;
  standardBonusAmount: number;
  cumulativeBonusAmount: number;
  isConfirmed: boolean;
  confirmedAt: string | null;
  confirmedBy: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface InsurancePremiumBreakdownResponse {
  employeeAmount: number;
  employerAmount: number;
}

export interface MonthlyInsuranceResponse {
  id: string;
  employeeId: string;
  yearMonth: string;
  officeId: string;
  healthGradeNumber: number;
  healthStandardRemuneration: number;
  pensionGradeNumber: number;
  pensionStandardRemuneration: number;
  healthInsurance: InsurancePremiumBreakdownResponse;
  longTermCareInsurance: InsurancePremiumBreakdownResponse | null;
  pensionInsurance: InsurancePremiumBreakdownResponse;
  childSupportContribution: InsurancePremiumBreakdownResponse;
  childSupportPayment?: InsurancePremiumBreakdownResponse;
  totalEmployeeAmount: number;
  totalEmployerAmount: number;
  isExempted: boolean;
  isConfirmed: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface BonusInsuranceResponse {
  id: string;
  employeeId: string;
  yearMonth: string;
  officeId: string;
  healthCappedAmount: number;
  pensionCappedAmount: number;
  healthInsurance: InsurancePremiumBreakdownResponse;
  longTermCareInsurance: InsurancePremiumBreakdownResponse | null;
  pensionInsurance: InsurancePremiumBreakdownResponse;
  childSupportContribution: InsurancePremiumBreakdownResponse;
  childSupportPayment?: InsurancePremiumBreakdownResponse;
  totalEmployeeAmount: number;
  totalEmployerAmount: number;
  isExempted: boolean;
  isConfirmed: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface FilingResponse {
  id: string;
  employeeId: string;
  filingType: string;
  workflowStatus: 'draft' | 'pending' | 'approved' | 'rejected';
  mockStatus: 'notStarted' | 'processing' | 'completed' | 'failed';
  submissionStatus: 'notSubmitted' | 'submitted' | 'accepted' | 'returned';
  effectiveDate: string;
  formData: Record<string, unknown>;
  submittedAt: string | null;
  resultReceivedAt: string | null;
  resultNote: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalRequestResponse {
  id: string;
  employeeId: string;
  targetPath: string;
  targetVersion: number;
  snapshotData: Record<string, unknown>;
  requestType: 'salary' | 'bonus' | 'monthlyInsurance' | 'filing' | 'employment' | 'grade';
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  requestedBy: string;
  requestedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InvitationResponse {
  id: string;
  email: string;
  roles: string[];
  officeIds: string[];
  employeeId: string | null;
  status: 'pending' | 'accepted' | 'expired';
  invitedBy: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ListResponse<T> {
  items: T[];
  total: number;
  hasMore: boolean;
  lastDocId?: string;
}

export interface MutationResponse {
  success: true;
  id: string;
}
