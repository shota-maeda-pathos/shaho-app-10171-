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

export interface AuditLogDoc {
  entity: 'employee' | 'dependent';
  entityId: string;
  action: 'create' | 'update' | 'delete' | 'transfer' | 'resign';
  changes: Record<string, { from: unknown; to: unknown }>;
  performedBy: string;
  performedAt: Timestamp;
  version: number;
}
