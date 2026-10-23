import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config';
import {
  AuthContext,
  isSelfAccess,
  requireLoginEnabled,
  requireNotSuspended,
  requireOffice,
  requireRole,
} from './auth';
import { EmployeeDoc } from '../types/firestore';
import { notFound } from '../utils/errors';

export async function requireDependentAccess(
  auth: AuthContext,
  companyId: string,
  employeeId: string,
): Promise<EmployeeDoc> {
  requireLoginEnabled(auth);

  const empRef = db.doc(`companies/${companyId}/employees/${employeeId}`);
  const empDoc = await empRef.get();
  if (!empDoc.exists || empDoc.data()!.deletedAt !== null) {
    throw notFound('従業員');
  }
  const employee = empDoc.data()! as EmployeeDoc;

  if (auth.isSuspended) {
    if (!isSelfAccess(auth, employee.userId)) {
      throw new HttpsError(
        'permission-denied',
        'アカウント停止中は本人の情報のみ閲覧できます',
      );
    }
    return employee;
  }

  requireNotSuspended(auth);
  requireRole(auth, 'admin', 'operator');
  if (!auth.roles.includes('admin')) {
    requireOffice(auth, employee.officeId);
  }

  return employee;
}

export async function requireDependentReadAccess(
  auth: AuthContext,
  companyId: string,
  employeeId: string,
): Promise<EmployeeDoc> {
  requireLoginEnabled(auth);

  const empRef = db.doc(`companies/${companyId}/employees/${employeeId}`);
  const empDoc = await empRef.get();
  if (!empDoc.exists || empDoc.data()!.deletedAt !== null) {
    throw notFound('従業員');
  }
  const employee = empDoc.data()! as EmployeeDoc;

  if (isSelfAccess(auth, employee.userId)) {
    return employee;
  }

  requireNotSuspended(auth);

  const hasReadRole = (['admin', 'operator', 'approver', 'viewer'] as const).some(
    (r) => auth.roles.includes(r),
  );
  if (!hasReadRole) {
    throw new HttpsError('permission-denied', '権限がありません');
  }
  if (!auth.roles.includes('admin')) {
    requireOffice(auth, employee.officeId);
  }

  return employee;
}
