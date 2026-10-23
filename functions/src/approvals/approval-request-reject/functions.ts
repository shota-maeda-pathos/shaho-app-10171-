import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { ApprovalRequestRejectSchema } from './schema';
import { rejectApprovalRequest } from './service';

export const approvalRequestReject = onCall(async (request) => {
  const input = validate(ApprovalRequestRejectSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin');
  return rejectApprovalRequest(input, auth);
});
