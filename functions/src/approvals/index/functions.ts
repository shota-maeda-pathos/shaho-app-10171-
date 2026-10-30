import { onCall } from 'firebase-functions/v2/https';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import {
  ApprovalBulkSchema, ApprovalCancelSchema, ApprovalCompanySchema, ApprovalDetailSchema, ApprovalSearchSchema, ApprovalSettingsSchema,
} from './schema';
import {
  approvalBadge, approvalDetail, approvalSettings, bulkApprove, cancelApproval, rebuildApprovalIndex, remindApprovals, searchApprovals,
  syncRequestIndex,
} from './service';

/** 承認申請の索引。Firestore のトリガーはデータベースと同じ地域に置く */
export const approvalIndexRequest = onDocumentWritten(
  { document: 'companies/{companyId}/employees/{employeeId}/approvalRequests/{requestId}', region: 'asia-northeast1' },
  async (event) => {
    await syncRequestIndex(event.document, event.data?.after.exists ? event.data.after.data() : undefined);
  },
);

const staff = async (request: Parameters<typeof getAuthContext>[0], companyId: string) => {
  const auth = await getAuthContext(request, companyId);
  requireRole(auth, 'admin', 'operator', 'approver');
  return auth;
};

/** 横断の承認一覧 */
export const approvalSearch = onCall({ timeoutSeconds: 60, memory: '512MiB' }, async (request) => {
  const input = validate(ApprovalSearchSchema, request.data);
  return searchApprovals(input, await staff(request, input.companyId));
});

/** サイドバーの未承認件数 */
export const approvalBadgeGet = onCall(async (request) => {
  const input = validate(ApprovalCompanySchema, request.data);
  return approvalBadge(await staff(request, input.companyId));
});

/** 承認の中身と前回の版との差分 */
export const approvalDetailGet = onCall(async (request) => {
  const input = validate(ApprovalDetailSchema, request.data);
  return approvalDetail(input, await staff(request, input.companyId));
});

/** 一括承認（承認者・管理者） */
export const approvalBulkApprove = onCall({ timeoutSeconds: 540, memory: '512MiB' }, async (request) => {
  const input = validate(ApprovalBulkSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'approver');
  return bulkApprove(input, auth);
});

/** 承認の取消（届出だけ） */
export const approvalCancel = onCall(async (request) => {
  const input = validate(ApprovalCancelSchema, request.data);
  return cancelApproval(input, await staff(request, input.companyId));
});

/** 放置とみなす日数 */
export const approvalSettingsGet = onCall(async (request) => {
  const input = validate(ApprovalSettingsSchema, request.data);
  return approvalSettings(input, await staff(request, input.companyId));
});

/** 既存の承認を索引に入れ直す（移行用。管理者だけ） */
export const approvalIndexRebuild = onCall({ timeoutSeconds: 540, memory: '1GiB', maxInstances: 1 }, async (request) => {
  const input = validate(ApprovalCompanySchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin');
  return rebuildApprovalIndex(auth);
});

/** 毎朝9時（東京）：期限が近い・止まっている承認待ちを通知する */
export const approvalReminder = onSchedule({ schedule: 'every day 09:00', timeZone: 'Asia/Tokyo', region: 'asia-northeast1', timeoutSeconds: 300 }, async () => {
  await remindApprovals();
});
