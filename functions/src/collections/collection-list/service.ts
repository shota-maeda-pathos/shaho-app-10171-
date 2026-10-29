import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { CollectionListInput } from './schema';
import { invalidArg } from '../../utils/errors';

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
  if(input.officeId) requireOffice(auth,input.officeId);
  if(!auth.roles.includes('admin')&&!auth.officeIds.length) return {items:[],hasMore:false};
  if(!input.officeId&&!auth.roles.includes('admin')&&auth.officeIds.length>30) throw invalidArg('事業所を選択してください');
  let query: FirebaseFirestore.Query = db
    .collection(`companies/${auth.companyId}/insuranceCollections`)
    .orderBy('yearMonth', 'desc');
  if(input.officeId) query=query.where('officeId','==',input.officeId);
  else if(!auth.roles.includes('admin')) query=query.where('officeId','in',auth.officeIds.slice(0,30));

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
