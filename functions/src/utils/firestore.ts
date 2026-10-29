import { Timestamp } from 'firebase-admin/firestore';
import { DependentDoc, EmployeeDoc } from '../types/firestore';
import { DependentResponse, EmployeeResponse } from '../types/response';

export function toISOString(ts: Timestamp): string {
  return ts.toDate().toISOString();
}

export function toDateString(ts: Timestamp): string {
  return ts.toDate().toISOString().slice(0, 10);
}

export function toNullableDateString(ts: Timestamp | null): string | null {
  return ts ? toDateString(ts) : null;
}

export function toTimestamp(iso: string): Timestamp {
  return Timestamp.fromDate(new Date(iso));
}

export function toNullableISO(ts: Timestamp | null): string | null {
  return ts ? toISOString(ts) : null;
}

export function toEmployeeResponse(
  id: string,
  data: Omit<EmployeeDoc, 'birthDate'> & { birthDate: Timestamp | null },
): EmployeeResponse {
  return {
    id,
    employeeNumber: data.employeeNumber,
    lastName: data.lastName,
    firstName: data.firstName,
    lastNameKana: data.lastNameKana,
    firstNameKana: data.firstNameKana,
    // Create/onboard allow an unknown birthday; keep the API's date-string contract.
    birthDate: data.birthDate ? toDateString(data.birthDate) : '',
    gender: data.gender,
    officeId: data.officeId,
    departmentId: data.departmentId,
    hireDate: toDateString(data.hireDate),
    resignationDate: toNullableDateString(data.resignationDate),
    isActive: data.isActive,
    version: data.version,
    createdAt: toISOString(data.createdAt),
    updatedAt: toISOString(data.updatedAt),
  };
}

export function toDependentResponse(
  id: string,
  employeeId: string,
  data: DependentDoc,
): DependentResponse {
  return {
    id,
    employeeId,
    lastName: data.lastName,
    firstName: data.firstName,
    lastNameKana: data.lastNameKana,
    firstNameKana: data.firstNameKana,
    birthDate: toDateString(data.birthDate),
    gender: data.gender,
    relationship: data.relationship,
    isDisabled: data.isDisabled,
    income: data.income,
    coResident: data.coResident,
    qualificationDate: toDateString(data.qualificationDate),
    disqualificationDate: toNullableDateString(data.disqualificationDate),
    createdAt: toISOString(data.createdAt),
    updatedAt: toISOString(data.updatedAt),
  };
}
