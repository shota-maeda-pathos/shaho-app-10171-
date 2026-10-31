import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { ReportSchema, buildReport } from './service';

/** 帳票5種の中身（カタログ9章）。管理者・担当者・承認者・閲覧者 */
export const reportData = onCall({ timeoutSeconds: 120, memory: '512MiB' }, async request => {
  const input = validate(ReportSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator', 'approver', 'viewer');
  return buildReport(auth, input);
});
