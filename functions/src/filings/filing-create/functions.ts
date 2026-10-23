import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { FilingCreateSchema } from './schema';
import { createFiling } from './service';

export const filingCreate = onCall(async (request) => {
  const input = validate(FilingCreateSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return createFiling(input, auth);
});
