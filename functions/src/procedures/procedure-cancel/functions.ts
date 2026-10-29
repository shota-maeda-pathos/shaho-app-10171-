import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { ProcedureCancelSchema } from './schema';
import { cancelProcedure } from './service';

export const procedureCancel = onCall(async (request) => {
  const input = validate(ProcedureCancelSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return cancelProcedure(input, auth);
});
