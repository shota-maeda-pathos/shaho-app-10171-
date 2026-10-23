import { db } from '../../config';
import { AuthContext } from '../../middleware/auth';
import { ApprovalRequestListInput } from './schema';

interface ApprovalRequestListItem {
  id: string;
  employeeId: string;
  employeeName: string;
  requestType: string;
  status: string;
  requestedBy: string;
  requestedAt: string;
  targetVersion: number;
}

export interface ApprovalRequestListResponse {
  items: ApprovalRequestListItem[];
}

export async function listApprovalRequests(
  input: ApprovalRequestListInput,
  auth: AuthContext,
): Promise<ApprovalRequestListResponse> {
  const effectiveLimit = input.limit ?? 50;

  const empSnap = await db
    .collection(`companies/${auth.companyId}/employees`)
    .where('deletedAt', '==', null)
    .orderBy('employeeNumber', 'asc')
    .get();

  const items: ApprovalRequestListItem[] = [];

  for (const empDoc of empSnap.docs) {
    const empData = empDoc.data();

    if (!auth.roles.includes('admin') && !auth.officeIds.includes(empData.officeId)) {
      continue;
    }

    let query: FirebaseFirestore.Query = db.collection(
      `companies/${auth.companyId}/employees/${empDoc.id}/approvalRequests`,
    );

    if (input.status) {
      query = query.where('status', '==', input.status);
    }
    if (input.requestType) {
      query = query.where('requestType', '==', input.requestType);
    }

    const reqSnap = await query.get();

    for (const reqDoc of reqSnap.docs) {
      const data = reqDoc.data();
      items.push({
        id: reqDoc.id,
        employeeId: empDoc.id,
        employeeName: `${empData.lastName} ${empData.firstName}`,
        requestType: data.requestType,
        status: data.status,
        requestedBy: data.requestedBy,
        requestedAt: data.requestedAt?.toDate?.()?.toISOString?.() ?? '',
        targetVersion: data.targetVersion,
      });
    }

    if (items.length >= effectiveLimit) break;
  }

  return { items: items.slice(0, effectiveLimit) };
}
