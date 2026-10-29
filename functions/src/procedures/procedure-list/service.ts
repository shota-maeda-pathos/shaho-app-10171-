import { db } from '../../config';
import { HttpsError } from 'firebase-functions/v2/https';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { invalidArg, notFound } from '../../utils/errors';
import { ProcedureDoc } from '../../types/firestore';
import { ProcedureListInput } from './schema';

export interface ProcedureListItem {
  id: string;
  procedureType: string;
  title: string;
  priority: string;
  status: string;
  statusReason: string;
  employeeId: string | null;
  employeeName: string;
  officeId: string;
  scope: string;
  assignedTo: string;
  deadline: string | null;
  effectiveDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProcedureListResponse {
  items: ProcedureListItem[];
  hasMore: boolean;
  lastDocId?: string;
}

export async function listProcedures(
  input: ProcedureListInput,
  auth: AuthContext,
): Promise<ProcedureListResponse> {
  const base = `companies/${auth.companyId}/procedures`;
  if (input.officeId) requireOffice(auth, input.officeId);
  if (!auth.roles.includes('admin') && auth.officeIds.length === 0) return { items: [], hasMore: false };
  if (!input.officeId && !auth.roles.includes('admin') && auth.officeIds.length > 30) {
    throw invalidArg('事業所を選択して手続きを表示してください');
  }
  let query: FirebaseFirestore.Query = db.collection(base).where('deletedAt', '==', null);

  if (input.status) {
    query = query.where('status', '==', input.status);
  }
  if (input.procedureType) {
    query = query.where('procedureType', '==', input.procedureType);
  }
  if (input.assignedTo) {
    query = query.where('assignedTo', '==', input.assignedTo);
  }
  if (input.employeeId) {
    query = query.where('employeeId', '==', input.employeeId);
  }

  // Office filter: admin sees all, operator sees own offices
  if (input.officeId) {
    query = query.where('officeId', '==', input.officeId);
  } else if (!auth.roles.includes('admin')) {
    if (auth.officeIds.length > 0) {
      query = query.where('officeId', 'in', auth.officeIds);
    }
  }

  query = query.orderBy('updatedAt', 'desc');

  if (input.cursor) {
    const cursorDoc = await db.doc(`${base}/${input.cursor}`).get();
    if (!cursorDoc.exists) throw notFound('手続きの続き');
    requireOffice(auth, cursorDoc.data()!.officeId);
    query = query.startAfter(cursorDoc);
  }

  const snap = await query.limit(input.limit + 1).get().catch((error: {code?:number}) => {
    if (error.code === 9) throw new HttpsError('unavailable', '手続き検索の準備中です。少し待って再読み込みしてください。');
    throw error;
  });
  const hasMore = snap.docs.length > input.limit;
  const docs = hasMore ? snap.docs.slice(0, input.limit) : snap.docs;

  const items: ProcedureListItem[] = docs.filter(doc => auth.roles.includes('admin') || !doc.data().targetOfficeId || auth.officeIds.includes(doc.data().targetOfficeId)).map((doc) => {
    const d = doc.data() as ProcedureDoc;
    return {
      id: doc.id,
      procedureType: d.procedureType,
      title: d.title,
      priority: d.priority,
      status: d.status,
      statusReason: d.statusReason,
      employeeId: d.employeeId,
      employeeName: d.employeeName,
      officeId: d.officeId,
      scope: d.scope,
      assignedTo: d.assignedTo,
      deadline: d.deadline?.toDate().toISOString().slice(0, 10) ?? null,
      effectiveDate: d.effectiveDate?.toDate().toISOString().slice(0, 10) ?? null,
      createdAt: d.createdAt.toDate().toISOString(),
      updatedAt: d.updatedAt.toDate().toISOString(),
    };
  });

  return {
    items,
    hasMore,
    lastDocId: docs.length > 0 ? docs[docs.length - 1].id : undefined,
  };
}
