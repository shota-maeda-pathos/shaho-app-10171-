import { onCall } from 'firebase-functions/v2/https';
import { leaveCreateSchema } from './schema';
import { createLeave } from './service';
import { getAuthContext, requireRole } from '../../middleware/auth';

export const leaveCreate = onCall(
  async (request) => {
    const input = leaveCreateSchema.parse(request.data);
    const auth = await getAuthContext(request, input.companyId);
    requireRole(auth, 'admin', 'operator');
    return createLeave(input, auth);
  },
);
