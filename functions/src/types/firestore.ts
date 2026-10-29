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
  roundingRule: 'truncate' | 'round' | 'ceil';
  isActive: boolean;
  version: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
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
  insuranceType: 'health' | 'pension' | 'childSupport' | 'longTermCare';
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

export interface EmploymentDoc {
  effectiveDate: string;
  employmentType: 'regular' | 'partTime' | 'contract';
  weeklyHours: number;
  monthlyDays: number;
  baseSalary: number;
  socialInsuranceEnrolled: boolean;
  longTermCareEnrolled: boolean;
  note: string;
  version: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
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
  confirmedAt: Timestamp | null;
  confirmedBy: string | null;
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

export interface AuditLogDoc {
  entity: 'employee' | 'dependent' | 'approvalRequest' | 'user' | 'invitation';
  entityId: string;
  action: 'create' | 'update' | 'delete' | 'transfer' | 'resign' | 'approve' | 'reject' | 'invite';
  changes: Record<string, { from: unknown; to: unknown }>;
  performedBy: string;
  performedAt: Timestamp;
  version: number;
}
