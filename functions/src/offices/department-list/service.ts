import { db } from '../../config';
import type { AuthContext } from '../../middleware/auth';
import type { DepartmentDoc } from '../../types/firestore';
import type { DepartmentResponse } from '../../types/response';
import { toISOString } from '../../utils/firestore';
import type { DepartmentListInput } from './schema';

function toDepartmentResponse(
  id: string,
  data: DepartmentDoc,
): DepartmentResponse {
  return {
    id,
    name: data.name,
    parentId: data.parentId ?? null,
    officeId: data.officeId,
    sortOrder: data.sortOrder,
    isActive: data.isActive,
    createdAt: toISOString(data.createdAt),
    updatedAt: toISOString(data.updatedAt),
  };
}

export async function listDepartments(
  input: DepartmentListInput,
  auth: AuthContext,
): Promise<{ items: DepartmentResponse[] }> {
  const collRef = db.collection(`companies/${auth.companyId}/departments`);

  let query: FirebaseFirestore.Query = collRef.orderBy('sortOrder', 'asc');

  if (!(input.includeInactive ?? false)) {
    query = query.where('isActive', '==', true);
  }

  if (input.officeId) {
    query = query.where('officeId', '==', input.officeId);
  } else if (!auth.roles.includes('admin')) {
    if (auth.officeIds.length === 0) {
      return { items: [] };
    }
    query = query.where('officeId', 'in', auth.officeIds);
  }

  const snap = await query.get();
  const items = snap.docs.map((d) =>
    toDepartmentResponse(d.id, d.data() as DepartmentDoc),
  );

  return { items };
}
