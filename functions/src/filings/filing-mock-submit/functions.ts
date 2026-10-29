import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { FilingMockSubmitSchema } from './schema';
import { mockSubmitFiling } from './service';

export const filingMockSubmit = onCall(async (request) => {
  const input = validate(FilingMockSubmitSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return mockSubmitFiling(input, auth);
});
