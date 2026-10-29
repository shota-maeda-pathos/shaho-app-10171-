import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { EmployeeDoc, GradeDoc } from '../../types/firestore';
import { MutationResponse } from '../../types/response';
import { notFound } from '../../utils/errors';
import { requestManualGrade } from '../manual-grade';
import { GradeUpdateInput } from './schema';

/** 等級の訂正。直接は書き換えず承認申請にする（承認されると訂正後の内容で確定する） */
export async function updateGrade(
  input: GradeUpdateInput,
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

  const gradeDoc = await db.doc(`${base}/grades/${input.gradeId}`).get();
  if (!gradeDoc.exists) {
    throw notFound('等級');
  }
  const current = gradeDoc.data()! as GradeDoc;
  if (current.version !== input.expectedVersion) {
    throw new HttpsError(
      'failed-precondition',
      `データが更新されています（現在のバージョン: ${current.version}）`,
    );
  }

  return requestManualGrade({
    companyId: auth.companyId,
    employeeId: input.employeeId,
    effectiveMonth: current.effectiveMonth,
    healthGradeNumber: input.healthGradeNumber ?? current.healthGradeNumber,
    pensionGradeNumber: input.pensionGradeNumber ?? current.pensionGradeNumber,
    determinationType: input.determinationType ?? current.determinationType,
    reason: input.reason,
  }, auth);
}
