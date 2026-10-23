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
  roundingRule: 'truncate' | 'round' | 'ceil';
  isActive: boolean;
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
  insuranceType: 'health' | 'pension' | 'childSupport' | 'longTermCare';
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
  employmentType: 'regular' | 'partTime' | 'contract';
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
