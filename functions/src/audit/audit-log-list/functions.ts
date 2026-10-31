import { onCall } from 'firebase-functions/v2/https';
import { validate } from '../../middleware/validation';
import { getAuthContext, requireLoginEnabled, requireNotSuspended, requireRole } from '../../middleware/auth';
import { auditLogFilterSchema, auditLogListSchema } from './schema';
import { exportAuditLogs, listAuditLogs, verifyAuditChain } from './service';
import { z } from 'zod';

export const auditLogList = onCall(async (request) => {
  const input = validate(auditLogListSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireLoginEnabled(auth);
  requireNotSuspended(auth);
  requireRole(auth, 'admin');
  return listAuditLogs(input, auth);
});

export const auditLogExport = onCall(async (request) => {
  const input = validate(auditLogFilterSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin');
  return exportAuditLogs(input, auth);
});

export const auditLogVerify = onCall({ timeoutSeconds: 300, memory: '512MiB' }, async (request) => {
  const input = validate(z.object({ companyId: z.string().min(1) }), request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin');
  return verifyAuditChain(auth);
});
