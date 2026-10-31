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

/** 部署の一覧。件数が少ないので全件を読み、絞り込みと並べ替えはここで行う（複合索引に頼らない） */
export async function listDepartments(
  input: DepartmentListInput,
  auth: AuthContext,
): Promise<{ items: DepartmentResponse[] }> {
  if (!input.officeId && !auth.roles.includes('admin') && auth.officeIds.length === 0) return { items: [] };
  const snap = await db.collection(`companies/${auth.companyId}/departments`).get();
  const items = snap.docs
    .map(d => toDepartmentResponse(d.id, d.data() as DepartmentDoc))
    .filter(d => input.includeInactive || d.isActive)
    .filter(d => (input.officeId ? d.officeId === input.officeId : auth.roles.includes('admin') || auth.officeIds.includes(d.officeId)))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, 'ja'));
  return { items };
}
