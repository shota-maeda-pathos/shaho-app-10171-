import { Timestamp } from 'firebase-admin/firestore';
import { DependentDoc, EmployeeDoc } from '../types/firestore';
import { DependentResponse, EmployeeResponse } from '../types/response';

export function toISOString(ts: Timestamp): string {
  return ts.toDate().toISOString();
}

export function toTimestamp(iso: string): Timestamp {
  return Timestamp.fromDate(new Date(iso));
}

export function toNullableISO(ts: Timestamp | null): string | null {
  return ts ? toISOString(ts) : null;
}

export function toEmployeeResponse(
  id: string,
  data: EmployeeDoc,
): EmployeeResponse {
  return {
    id,
    employeeNumber: data.employeeNumber,
    lastName: data.lastName,
    firstName: data.firstName,
    lastNameKana: data.lastNameKana,
    firstNameKana: data.firstNameKana,
    birthDate: toISOString(data.birthDate),
    gender: data.gender,
    officeId: data.officeId,
    departmentId: data.departmentId,
    hireDate: toISOString(data.hireDate),
    resignationDate: toNullableISO(data.resignationDate),
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
    birthDate: toISOString(data.birthDate),
    gender: data.gender,
    relationship: data.relationship,
    isDisabled: data.isDisabled,
    income: data.income,
    coResident: data.coResident,
    qualificationDate: toISOString(data.qualificationDate),
    disqualificationDate: toNullableISO(data.disqualificationDate),
    createdAt: toISOString(data.createdAt),
    updatedAt: toISOString(data.updatedAt),
  };
}
