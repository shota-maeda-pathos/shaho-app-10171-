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
