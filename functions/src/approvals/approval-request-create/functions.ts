import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { ApprovalRequestCreateSchema } from './schema';
import { createApprovalRequest } from './service';

export const approvalRequestCreate = onCall(async (request) => {
  const input = validate(ApprovalRequestCreateSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return createApprovalRequest(input, auth);
});
