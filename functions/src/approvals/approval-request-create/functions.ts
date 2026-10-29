import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { ApprovalRequestCreateSchema } from './schema';
import { createApprovalRequest } from './service';
import { invalidArg } from '../../utils/errors';

export const approvalRequestCreate = onCall(async (request) => {
  const input = validate(ApprovalRequestCreateSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  // 届出の承認で確定する等級は、サーバーが再計算したもの（入社手続き）だけを受け付ける
  if (input.metadata && 'grade' in input.metadata) throw invalidArg('等級は画面から指定できません');
  return createApprovalRequest(input, auth);
});
