import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { leaveUpdateSchema } from './schema';
import { updateLeave } from './service';
export const leaveUpdate = onCall({ region: 'us-central1' }, async request => {
  const input = validate(leaveUpdateSchema, request.data);
  return updateLeave(input, await getAuthContext(request, input.companyId));
});
