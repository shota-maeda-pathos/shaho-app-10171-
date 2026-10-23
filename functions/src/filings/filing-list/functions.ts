import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { FilingListSchema } from './schema';
import { listFilings } from './service';

export const filingList = onCall(async (request) => {
  const input = validate(FilingListSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return listFilings(input, auth);
});
