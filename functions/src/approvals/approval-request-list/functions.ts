import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { ApprovalRequestListSchema } from './schema';
import { listApprovalRequests } from './service';

export const approvalRequestList = onCall(async (request) => {
  const input = validate(ApprovalRequestListSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'approver', 'operator');
  return listApprovalRequests(input, auth);
});
