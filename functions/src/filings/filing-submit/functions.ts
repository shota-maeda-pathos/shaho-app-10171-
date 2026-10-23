import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { FilingSubmitSchema } from './schema';
import { submitFiling } from './service';

export const filingSubmit = onCall(async (request) => {
  const input = validate(FilingSubmitSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return submitFiling(input, auth);
});
