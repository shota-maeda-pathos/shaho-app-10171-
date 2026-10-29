import { onCall } from 'firebase-functions/v2/https';
import { validate } from '../../middleware/validation';
import { getAuthContext, requireLoginEnabled, requireNotSuspended, requireRole } from '../../middleware/auth';
import { auditLogListSchema } from './schema';
import { listAuditLogs } from './service';

export const auditLogList = onCall(async (request) => {
  const input = validate(auditLogListSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireLoginEnabled(auth);
  requireNotSuspended(auth);
  requireRole(auth, 'admin');
  return listAuditLogs(input, auth);
});
