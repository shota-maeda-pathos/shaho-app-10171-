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

export interface AuditLogDoc {
  entity: 'employee' | 'dependent';
  entityId: string;
  action: 'create' | 'update' | 'delete' | 'transfer' | 'resign';
  changes: Record<string, { from: unknown; to: unknown }>;
  performedBy: string;
  performedAt: Timestamp;
  version: number;
}
