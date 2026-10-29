import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { AgeEventCheckSchema } from './schema';
import { checkAgeEvents } from './service';

export const ageEventCheck = onCall(async (request) => {
  const input = validate(AgeEventCheckSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return checkAgeEvents(auth, input.yearMonth);
});
