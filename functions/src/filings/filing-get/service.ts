import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../../config';
import { AuthContext } from '../../middleware/auth';
import { FilingGetInput } from './schema';
import { isSubmittedFiling } from '../correction/rules';

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
  /** 訂正届・取消届：元の届出・訂正箇所・理由 */
  originalFilingId: string | null;
  originalFilingType: string | null;
  corrections: { field: string; before: string; after: string }[];
  reason: string | null;
  /** 元の届出：あとから出した訂正届・取消届 */
  correctedByFilingIds: string[];
  cancelledByFilingId: string | null;
  cancelledAt: string | null;
  /** 提出を終えているか（訂正届・取消届を作れるか） */
  submitted: boolean;
  /** いちばん新しい承認申請の結果（差し戻しの理由を画面に出す） */
  lastApproval: { status: string; comment: string | null; reviewedAt: string | null } | null;
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
  const requests = await db.collection(`companies/${auth.companyId}/employees/${input.employeeId}/approvalRequests`)
    .where('targetPath', '==', filingRef.path).get();
  const last = requests.docs.map(d => d.data()).sort((a, b) => (b.requestedAt?.toMillis?.() ?? 0) - (a.requestedAt?.toMillis?.() ?? 0))[0];
  return {
    id: filingSnap.id,
    employeeId: input.employeeId,
    employeeName: `${empData.lastName} ${empData.firstName}`,
    filingType: data.filingType,
    // 承認を依頼したあとも届出の workflowStatus は下書き・差戻しのまま。画面には最新の依頼が承認待ちなら「承認待ち」と出す
    workflowStatus: (data.workflowStatus === 'draft' || data.workflowStatus === 'rejected') && last?.status === 'pending' ? 'pending' : data.workflowStatus,
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
    originalFilingId: data.originalFilingId ?? null,
    originalFilingType: data.originalFilingType ?? null,
    corrections: data.corrections ?? [],
    reason: data.reason ?? null,
    correctedByFilingIds: data.correctedByFilingIds ?? [],
    cancelledByFilingId: data.cancelledByFilingId ?? null,
    cancelledAt: data.cancelledAt?.toDate?.()?.toISOString?.() ?? null,
    submitted: isSubmittedFiling(data),
    lastApproval: last ? { status: last.status, comment: last.comment ?? null, reviewedAt: last.reviewedAt?.toDate?.()?.toISOString?.() ?? null } : null,
  };
}
