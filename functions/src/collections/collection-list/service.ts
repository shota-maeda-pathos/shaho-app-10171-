import { db } from '../../config';
import { AuthContext } from '../../middleware/auth';
import { CollectionListInput } from './schema';

interface CollectionListItem {
  id: string;
  yearMonth: string;
  collectionType: string;
  officeId: string | null;
  status: string;
  totalEmployeeAmount: number;
  totalEmployerAmount: number;
  totalAmount: number;
  employeeCount: number;
  dueDate: string | null;
}

export interface CollectionListResponse {
  items: CollectionListItem[];
  hasMore: boolean;
}

export async function listCollections(
  input: CollectionListInput,
  auth: AuthContext,
): Promise<CollectionListResponse> {
  const effectiveLimit = input.limit ?? 20;
  let query: FirebaseFirestore.Query = db
    .collection(`companies/${auth.companyId}/insuranceCollections`)
    .orderBy('yearMonth', 'desc');

  if (input.collectionType) {
    query = query.where('collectionType', '==', input.collectionType);
  }
  if (input.yearMonth) {
    query = query.where('yearMonth', '==', input.yearMonth);
  }

  if (input.lastDocId) {
    const cursor = await db
      .doc(`companies/${auth.companyId}/insuranceCollections/${input.lastDocId}`)
      .get();
    if (cursor.exists) query = query.startAfter(cursor);
  }

  const snap = await query.limit(effectiveLimit + 1).get();
  const items = snap.docs.slice(0, effectiveLimit).map((doc) => {
    const d = doc.data();
    return {
      id: doc.id,
      yearMonth: d.yearMonth,
      collectionType: d.collectionType,
      officeId: d.officeId ?? null,
      status: d.status,
      totalEmployeeAmount: d.totalEmployeeAmount ?? 0,
      totalEmployerAmount: d.totalEmployerAmount ?? 0,
      totalAmount: d.totalAmount ?? 0,
      employeeCount: d.employeeCount ?? 0,
      dueDate: d.dueDate ?? null,
    };
  });

  return { items, hasMore: snap.docs.length > effectiveLimit };
}
