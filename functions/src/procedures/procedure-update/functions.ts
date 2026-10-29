import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { ProcedureUpdateSchema } from './schema';
import { updateProcedure } from './service';

export const procedureUpdate = onCall(async (request) => {
  const input = validate(ProcedureUpdateSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return updateProcedure(input, auth);
});
