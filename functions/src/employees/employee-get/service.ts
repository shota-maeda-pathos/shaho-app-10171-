import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../../config';
import {
  AuthContext,
  Role,
  isSelfAccess,
  requireNotSuspended,
} from '../../middleware/auth';
import { EmployeeDoc } from '../../types/firestore';
import { EmployeeResponse } from '../../types/response';
import { notFound } from '../../utils/errors';
import { toEmployeeResponse } from '../../utils/firestore';

export async function getEmployee(
  companyId: string,
  employeeId: string,
  auth: AuthContext,
): Promise<EmployeeResponse> {
  const doc = await db
    .doc(`companies/${companyId}/employees/${employeeId}`)
    .get();
  if (!doc.exists || doc.data()!.deletedAt !== null) {
    throw notFound('従業員');
  }
  const data = doc.data()! as EmployeeDoc;

  if (isSelfAccess(auth, data.userId)) {
    return toEmployeeResponse(doc.id, data);
  }

  requireNotSuspended(auth);

  const hasAdminRole = (['admin', 'operator', 'approver', 'viewer'] as Role[]).some(
    (r) => auth.roles.includes(r),
  );
  const isOfficeMatch =
    auth.roles.includes('admin') || auth.officeIds.includes(data.officeId);

  if (!(hasAdminRole && isOfficeMatch)) {
    throw new HttpsError('permission-denied', 'アクセス権がありません');
  }

  return toEmployeeResponse(doc.id, data);
}
