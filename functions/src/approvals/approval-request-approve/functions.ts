import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { ApprovalRequestApproveSchema } from './schema';
import { approveApprovalRequest } from './service';

export const approvalRequestApprove = onCall(async (request) => {
  const input = validate(ApprovalRequestApproveSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'approver', 'operator');
  return approveApprovalRequest(input, auth);
});
