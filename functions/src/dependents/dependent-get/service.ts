import { db } from '../../config';
import { AuthContext } from '../../middleware/auth';
import { DependentDoc } from '../../types/firestore';
import { DependentResponse } from '../../types/response';
import { notFound } from '../../utils/errors';
import { toDependentResponse } from '../../utils/firestore';

export async function getDependent(
  companyId: string,
  employeeId: string,
  dependentId: string,
  _auth: AuthContext,
): Promise<DependentResponse> {
  const doc = await db
    .doc(
      `companies/${companyId}/employees/${employeeId}/dependents/${dependentId}`,
    )
    .get();
  if (!doc.exists || doc.data()!.deletedAt !== null) {
    throw notFound('扶養家族');
  }

  return toDependentResponse(
    doc.id,
    employeeId,
    doc.data()! as DependentDoc,
  );
}
