import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { ProcedureGetSchema } from './schema';
import { getProcedure } from './service';

export const procedureGet = onCall(async (request) => {
  const input = validate(ProcedureGetSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator', 'approver');
  return getProcedure(input, auth);
});
