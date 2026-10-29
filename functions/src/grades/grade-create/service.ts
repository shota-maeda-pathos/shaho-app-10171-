import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { EmployeeDoc } from '../../types/firestore';
import { MutationResponse } from '../../types/response';
import { alreadyExists, notFound } from '../../utils/errors';
import { requestManualGrade } from '../manual-grade';
import { GradeCreateInput } from './schema';

/** 等級の手入力。直接は作らず承認申請にする（承認されると作られる） */
export async function createGrade(
  input: GradeCreateInput,
  auth: AuthContext,
): Promise<MutationResponse> {
  const base = `companies/${auth.companyId}/employees/${input.employeeId}`;
  const empDoc = await db.doc(base).get();
  if (!empDoc.exists || empDoc.data()!.deletedAt !== null) {
    throw notFound('従業員');
  }
  const employee = empDoc.data()! as EmployeeDoc;
  if (!auth.roles.includes('admin')) {
    requireOffice(auth, employee.officeId);
  }

  const existing = await db.doc(`${base}/grades/${input.effectiveMonth}`).get();
  if (existing.exists) {
    throw alreadyExists('この適用月の等級');
  }

  return requestManualGrade({ ...input, companyId: auth.companyId }, auth);
}
