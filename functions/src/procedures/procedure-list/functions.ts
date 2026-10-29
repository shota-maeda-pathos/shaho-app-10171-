import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { ProcedureListSchema } from './schema';
import { listProcedures } from './service';

export const procedureList = onCall(async (request) => {
  const input = validate(ProcedureListSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator', 'approver');
  return listProcedures(input, auth);
});
