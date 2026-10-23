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

  let query: FirebaseFirestore.Query = collRef.orderBy('createdAt', 'asc');

  if (!input.includeDeleted) {
    query = query.where('deletedAt', '==', null);
  }

  const countSnap = await query.count().get();
  const total = countSnap.data().count;

  if (input.lastDocId) {
    const lastDoc = await db
      .doc(
        `companies/${auth.companyId}/employees/${input.employeeId}/dependents/${input.lastDocId}`,
      )
      .get();
    if (lastDoc.exists) {
      query = query.startAfter(lastDoc);
    }
  }
  query = query.limit(limit + 1);

  const snap = await query.get();
  const hasMore = snap.docs.length > limit;
  const docs = hasMore ? snap.docs.slice(0, limit) : snap.docs;

  return {
    items: docs.map((d) =>
      toDependentResponse(d.id, input.employeeId, d.data() as DependentDoc),
    ),
    total,
    hasMore,
    lastDocId: docs.length > 0 ? docs[docs.length - 1].id : undefined,
  };
}
