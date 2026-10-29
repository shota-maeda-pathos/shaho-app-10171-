import { db } from '../../config';
import { AuthContext } from '../../middleware/auth';
import { DependentDoc } from '../../types/firestore';
import { DependentResponse, ListResponse } from '../../types/response';
import { toDependentResponse } from '../../utils/firestore';
import { DependentListInput } from './schema';

export async function listDependents(
  input: DependentListInput,
  auth: AuthContext,
): Promise<ListResponse<DependentResponse>> {
  const collRef = db.collection(
    `companies/${auth.companyId}/employees/${input.employeeId}/dependents`,
  );
  const limit = input.limit ?? 20;

  // 複合索引（deletedAt＋createdAt）に頼らない。1人の扶養家族は少ないので、読んでから並べる
  const all = await (input.includeDeleted ? collRef : collRef.where('deletedAt', '==', null)).get();
  const sorted = [...all.docs].sort((a, b) =>
    ((a.data().createdAt as FirebaseFirestore.Timestamp | undefined)?.toMillis() ?? 0) - ((b.data().createdAt as FirebaseFirestore.Timestamp | undefined)?.toMillis() ?? 0)
    || a.id.localeCompare(b.id));
  const total = sorted.length;
  const start = input.lastDocId ? sorted.findIndex(d => d.id === input.lastDocId) + 1 : 0;
  const page = sorted.slice(start, start + limit + 1);
  const hasMore = page.length > limit;
  const docs = hasMore ? page.slice(0, limit) : page;

  return {
    items: docs.map((d) =>
      toDependentResponse(d.id, input.employeeId, d.data() as DependentDoc),
    ),
    total,
    hasMore,
    lastDocId: docs.length > 0 ? docs[docs.length - 1].id : undefined,
  };
}
