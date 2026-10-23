import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../../config';
import { AuthContext } from '../../middleware/auth';
import { FilingGetInput } from './schema';

export interface FilingGetResponse {
  id: string;
  employeeId: string;
  employeeName: string;
  filingType: string;
  workflowStatus: string;
  mockStatus: string;
  submissionStatus: string;
  effectiveDate: string;
  formData: Record<string, unknown>;
  submittedAt: string | null;
  resultReceivedAt: string | null;
  resultNote: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export async function getFiling(
  input: FilingGetInput,
  auth: AuthContext,
): Promise<FilingGetResponse> {
  const empRef = db.doc(`companies/${auth.companyId}/employees/${input.employeeId}`);
  const empSnap = await empRef.get();
  if (!empSnap.exists) {
    throw new HttpsError('not-found', '従業員が見つかりません');
  }
  const empData = empSnap.data()!;

  if (!auth.roles.includes('admin') && !auth.officeIds.includes(empData.officeId)) {
    throw new HttpsError('permission-denied', 'この事業所へのアクセス権がありません');
  }

  const filingRef = db.doc(
    `companies/${auth.companyId}/employees/${input.employeeId}/filings/${input.filingId}`,
  );
  const filingSnap = await filingRef.get();
  if (!filingSnap.exists) {
    throw new HttpsError('not-found', '届出が見つかりません');
  }

  const data = filingSnap.data()!;
  return {
    id: filingSnap.id,
    employeeId: input.employeeId,
    employeeName: `${empData.lastName} ${empData.firstName}`,
    filingType: data.filingType,
    workflowStatus: data.workflowStatus,
    mockStatus: data.mockStatus,
    submissionStatus: data.submissionStatus,
    effectiveDate: data.effectiveDate,
    formData: data.formData ?? {},
    submittedAt: data.submittedAt?.toDate?.()?.toISOString?.() ?? null,
    resultReceivedAt: data.resultReceivedAt?.toDate?.()?.toISOString?.() ?? null,
    resultNote: data.resultNote ?? null,
    version: data.version,
    createdAt: data.createdAt?.toDate?.()?.toISOString?.() ?? '',
    updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() ?? '',
  };
}
