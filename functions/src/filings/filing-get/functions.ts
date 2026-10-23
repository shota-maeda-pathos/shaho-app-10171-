import { onCall } from 'firebase-functions/v2/https';
import { validate } from '../../middleware/validation';
import { getAuthContext, requireLoginEnabled, requireNotSuspended, requireRole } from '../../middleware/auth';
import { FilingGetSchema } from './schema';
import { getFiling } from './service';

export const filingGet = onCall(async (request) => {
  const input = validate(FilingGetSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireLoginEnabled(auth);
  requireNotSuspended(auth);
  requireRole(auth, 'admin', 'operator');
  return getFiling(input, auth);
});
