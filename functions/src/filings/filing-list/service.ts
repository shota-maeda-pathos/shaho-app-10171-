import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { FilingListInput } from './schema';

interface FilingListItem {
  id: string;
  employeeId: string;
  employeeName: string;
  filingType: string;
  workflowStatus: string;
  mockStatus: string;
  submissionStatus: string;
  effectiveDate: string;
}

export interface FilingListResponse {
  items: FilingListItem[];
  hasMore: boolean;
}

export async function listFilings(
  input: FilingListInput,
  auth: AuthContext,
): Promise<FilingListResponse> {
  const effectiveLimit = input.limit ?? 20;
  if (input.officeId) requireOffice(auth, input.officeId);

  if (input.employeeId) {
    return listForEmployee(auth.companyId, input.employeeId, input, effectiveLimit, auth);
  }

  const empSnap = await db
    .collection(`companies/${auth.companyId}/employees`)
    .where('deletedAt', '==', null)
    .where('isActive', '==', true)
    .orderBy('employeeNumber', 'asc')
    .get();

  const items: FilingListItem[] = [];

  for (const empDoc of empSnap.docs) {
    const empData = empDoc.data();
    if (input.officeId && empData.officeId !== input.officeId) continue;

    if (!auth.roles.includes('admin') && !auth.officeIds.includes(empData.officeId)) {
      continue;
    }

    let query: FirebaseFirestore.Query = db.collection(
      `companies/${auth.companyId}/employees/${empDoc.id}/filings`,
    );

    if (input.workflowStatus) {
      query = query.where('workflowStatus', '==', input.workflowStatus);
    }
    if (input.submissionStatus) {
      query = query.where('submissionStatus', '==', input.submissionStatus);
    }
    if (input.filingType) {
      query = query.where('filingType', '==', input.filingType);
    }

    const filingSnap = await query.get();

    for (const filingDoc of filingSnap.docs) {
      const data = filingDoc.data();
      items.push({
        id: filingDoc.id,
        employeeId: empDoc.id,
        employeeName: `${empData.lastName} ${empData.firstName}`,
        filingType: data.filingType,
        workflowStatus: data.workflowStatus,
        mockStatus: data.mockStatus,
        submissionStatus: data.submissionStatus,
        effectiveDate: data.effectiveDate,
      });
    }
  }

  const hasMore = items.length > effectiveLimit;
  return {
    items: hasMore ? items.slice(0, effectiveLimit) : items,
    hasMore,
  };
}

async function listForEmployee(
  companyId: string,
  employeeId: string,
  input: FilingListInput,
  limit: number,
  auth: AuthContext,
): Promise<FilingListResponse> {
  const empRef = db.doc(`companies/${companyId}/employees/${employeeId}`);
  const empSnap = await empRef.get();
  if (!empSnap.exists) return { items: [], hasMore: false };

  const empData = empSnap.data()!;
  requireOffice(auth, empData.officeId);
  if (empData.deletedAt != null || (input.officeId && empData.officeId !== input.officeId)) return {items:[],hasMore:false};

  let query: FirebaseFirestore.Query = db.collection(
    `companies/${companyId}/employees/${employeeId}/filings`,
  );

  if (input.workflowStatus) {
    query = query.where('workflowStatus', '==', input.workflowStatus);
  }
  if (input.submissionStatus) {
    query = query.where('submissionStatus', '==', input.submissionStatus);
  }

  const snap = await query.get();
  const items: FilingListItem[] = snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      employeeId,
      employeeName: `${empData.lastName} ${empData.firstName}`,
      filingType: data.filingType,
      workflowStatus: data.workflowStatus,
      mockStatus: data.mockStatus,
      submissionStatus: data.submissionStatus,
      effectiveDate: data.effectiveDate,
    };
  });

  const hasMore = items.length > limit;
  return {
    items: hasMore ? items.slice(0, limit) : items,
    hasMore,
  };
}
