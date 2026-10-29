import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
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
  summary: { yearMonth: string | null; totalAmount: number | null; cumulativeBonusAmount: number | null; totalEmployee: number | null; totalEmployer: number | null } | null;
}

export interface ApprovalRequestListResponse {
  items: ApprovalRequestListItem[];
}

export async function listApprovalRequests(
  input: ApprovalRequestListInput,
  auth: AuthContext,
): Promise<ApprovalRequestListResponse> {
  const effectiveLimit = input.limit ?? 50;
  if (input.officeId) requireOffice(auth, input.officeId);

  const empSnap = await db
    .collection(`companies/${auth.companyId}/employees`)
    .where('deletedAt', '==', null)
    .get();

  const items: ApprovalRequestListItem[] = [];

  for (const empDoc of empSnap.docs) {
    const empData = empDoc.data();
    if (input.officeId && empData.officeId !== input.officeId) continue;

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
        summary: ['bonus', 'bonusInsurance'].includes(data.requestType) ? {
          yearMonth: data.snapshotData?.yearMonth ?? null,
          totalAmount: data.snapshotData?.totalAmount ?? data.snapshotData?.totalBonusAmount ?? null,
          cumulativeBonusAmount: data.snapshotData?.cumulativeBonusAmount ?? null,
          totalEmployee: data.snapshotData?.totalEmployeeAmount ?? null,
          totalEmployer: data.snapshotData?.totalEmployerAmount ?? null,
        } : null,
      });
    }

    if (items.length >= effectiveLimit) break;
  }

  return { items: items.slice(0, effectiveLimit) };
}
