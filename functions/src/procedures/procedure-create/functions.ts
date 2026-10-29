import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { ProcedureCreateSchema } from './schema';
import { createProcedure } from './service';

export const procedureCreate = onCall(async (request) => {
  const input = validate(ProcedureCreateSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return createProcedure(input, auth);
});
