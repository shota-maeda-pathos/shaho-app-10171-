import { db } from '../../config';
import { HttpsError } from 'firebase-functions/v2/https';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { LeaveListInput } from './schema';

const LEAVE_LABELS: Record<string, string> = {
  maternity: '産前産後休業',
  childcare: '育児休業',
  nursing: '介護休業',
};

interface LeaveListItem {
  id: string;
  employeeId: string;
  employeeName: string;
  leaveType: string;
  leaveTypeLabel: string;
  expectedStartDate: string;
  expectedEndDate: string;
  actualStartDate: string | null;
  actualEndDate: string | null;
  status: string;
  version: number;
  /** 産休・育休の手続き（ウィザード）で作った休業は、その手続き。開始・終了は手続きで記録する */
  procedureId: string | null;
}

export interface LeaveListResponse {
  items: LeaveListItem[];
  hasMore: boolean;
}

export async function listLeaves(
  input: LeaveListInput,
  auth: AuthContext,
): Promise<LeaveListResponse> {
  const effectiveLimit = input.limit ?? 20;
  const base = `companies/${auth.companyId}`;

  if (input.employeeId) {
    return listForEmployee(base, input.employeeId, input, effectiveLimit, auth);
  }

  const empSnap = await db
    .collection(`${base}/employees`)
    .where('deletedAt', '==', null)
    .where('isActive', '==', true)
    .orderBy('employeeNumber', 'asc')
    .get();

  const items: LeaveListItem[] = [];
  for (const empDoc of empSnap.docs) {
    const emp = empDoc.data();
    if (!auth.roles.includes('admin') && !auth.officeIds.includes(emp.officeId)) continue;
    let query = db
      .collection(`${base}/employees/${empDoc.id}/leaves`)
      .orderBy('expectedStartDate', 'desc') as FirebaseFirestore.Query;

    if (input.leaveType) query = query.where('leaveType', '==', input.leaveType);
    if (input.status) query = query.where('status', '==', input.status);

    const snap = await query.limit(effectiveLimit + 1).get();
    for (const doc of snap.docs) {
      const d = doc.data();
      items.push({
        id: doc.id,
        employeeId: empDoc.id,
        employeeName: `${emp.lastName} ${emp.firstName}`,
        leaveType: d.leaveType,
        leaveTypeLabel: LEAVE_LABELS[d.leaveType] ?? d.leaveType,
        expectedStartDate: d.expectedStartDate,
        expectedEndDate: d.expectedEndDate,
        actualStartDate: d.actualStartDate ?? null,
        actualEndDate: d.actualEndDate ?? null,
        status: d.status,
        version: d.version ?? 1,
        procedureId: d.procedureId ?? null,
      });
    }
  }

  items.sort((a, b) => b.expectedStartDate.localeCompare(a.expectedStartDate));
  const hasMore = items.length > effectiveLimit;
  return { items: items.slice(0, effectiveLimit), hasMore };
}

async function listForEmployee(
  base: string,
  employeeId: string,
  input: LeaveListInput,
  limit: number,
  auth: AuthContext,
): Promise<LeaveListResponse> {
  const empDoc = await db.doc(`${base}/employees/${employeeId}`).get();
  if (!empDoc.exists || empDoc.data()?.deletedAt !== null) {
    throw new HttpsError('not-found', '従業員が見つかりません');
  }
  const emp = empDoc.data()!;
  requireOffice(auth, emp.officeId);

  let query = db
    .collection(`${base}/employees/${employeeId}/leaves`)
    .orderBy('expectedStartDate', 'desc') as FirebaseFirestore.Query;

  if (input.leaveType) query = query.where('leaveType', '==', input.leaveType);
  if (input.status) query = query.where('status', '==', input.status);

  if (input.lastDocId) {
    const cursor = await db
      .doc(`${base}/employees/${employeeId}/leaves/${input.lastDocId}`)
      .get();
    if (cursor.exists) query = query.startAfter(cursor);
  }

  const snap = await query.limit(limit + 1).get();
  const items = snap.docs.slice(0, limit).map((doc) => {
    const d = doc.data();
    return {
      id: doc.id,
      employeeId,
      employeeName: `${emp.lastName ?? ''} ${emp.firstName ?? ''}`,
      leaveType: d.leaveType,
      leaveTypeLabel: LEAVE_LABELS[d.leaveType] ?? d.leaveType,
      expectedStartDate: d.expectedStartDate,
      expectedEndDate: d.expectedEndDate,
      actualStartDate: d.actualStartDate ?? null,
      actualEndDate: d.actualEndDate ?? null,
      status: d.status,
      version: d.version ?? 1,
      procedureId: d.procedureId ?? null,
    };
  });

  return { items, hasMore: snap.docs.length > limit };
}
