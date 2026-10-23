import { db } from '../../config';
import { AuthContext } from '../../middleware/auth';
import { EmployeeDoc } from '../../types/firestore';
import { EmployeeResponse, ListResponse } from '../../types/response';
import { toEmployeeResponse } from '../../utils/firestore';
import { EmployeeListInput } from './schema';

export async function listEmployees(
  input: EmployeeListInput,
  auth: AuthContext,
): Promise<ListResponse<EmployeeResponse>> {
  const { companyId } = auth;
  const collRef = db.collection(`companies/${companyId}/employees`);

  const targetOfficeIds = auth.roles.includes('admin')
    ? null
    : auth.officeIds;

  if (targetOfficeIds && targetOfficeIds.length === 0) {
    return { items: [], total: 0, hasMore: false };
  }

  if (input.keyword) {
    return searchByKana(collRef, input, targetOfficeIds, companyId);
  }

  let query: FirebaseFirestore.Query = collRef
    .where('deletedAt', '==', null)
    .orderBy('employeeNumber', 'asc');

  if (targetOfficeIds) {
    query = query.where('officeId', 'in', targetOfficeIds);
  }
  if (input.officeId) {
    query = query.where('officeId', '==', input.officeId);
  }
  if (input.departmentId) {
    query = query.where('departmentId', '==', input.departmentId);
  }
  if (!input.includeResigned) {
    query = query.where('isActive', '==', true);
  }

  const countSnap = await query.count().get();
  const total = countSnap.data().count;

  if (input.lastDocId) {
    const lastDoc = await db
      .doc(`companies/${companyId}/employees/${input.lastDocId}`)
      .get();
    if (lastDoc.exists) {
      query = query.startAfter(lastDoc);
    }
  }
  const effectiveLimit = input.limit ?? 20;
  query = query.limit(effectiveLimit + 1);

  const snap = await query.get();
  const hasMore = snap.docs.length > effectiveLimit;
  const docs = hasMore ? snap.docs.slice(0, effectiveLimit) : snap.docs;

  return {
    items: docs.map((d) =>
      toEmployeeResponse(d.id, d.data() as EmployeeDoc),
    ),
    total,
    hasMore,
    lastDocId: docs.length > 0 ? docs[docs.length - 1].id : undefined,
  };
}

async function searchByKana(
  collRef: FirebaseFirestore.CollectionReference,
  input: EmployeeListInput,
  targetOfficeIds: string[] | null,
  companyId: string,
): Promise<ListResponse<EmployeeResponse>> {
  const keyword = input.keyword!;
  let query: FirebaseFirestore.Query = collRef
    .where('deletedAt', '==', null)
    .orderBy('lastNameKana', 'asc')
    .where('lastNameKana', '>=', keyword)
    .where('lastNameKana', '<', keyword + '');

  if (targetOfficeIds) {
    query = query.where('officeId', 'in', targetOfficeIds);
  }
  if (input.departmentId) {
    query = query.where('departmentId', '==', input.departmentId);
  }
  if (!input.includeResigned) {
    query = query.where('isActive', '==', true);
  }

  const countSnap = await query.count().get();
  const total = countSnap.data().count;

  if (input.lastDocId) {
    const lastDoc = await db
      .doc(`companies/${companyId}/employees/${input.lastDocId}`)
      .get();
    if (lastDoc.exists) {
      query = query.startAfter(lastDoc);
    }
  }
  const effectiveLimit = input.limit ?? 20;
  query = query.limit(effectiveLimit + 1);

  const snap = await query.get();
  const hasMore = snap.docs.length > effectiveLimit;
  const docs = hasMore ? snap.docs.slice(0, effectiveLimit) : snap.docs;

  return {
    items: docs.map((d) =>
      toEmployeeResponse(d.id, d.data() as EmployeeDoc),
    ),
    total,
    hasMore,
    lastDocId: docs.length > 0 ? docs[docs.length - 1].id : undefined,
  };
}
