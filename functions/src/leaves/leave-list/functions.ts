import { onCall } from 'firebase-functions/v2/https';
import { leaveListSchema } from './schema';
import { listLeaves } from './service';
import { getAuthContext, requireRole } from '../../middleware/auth';

export const leaveList = onCall(
  { region: 'us-central1' },
  async (request) => {
    const input = leaveListSchema.parse(request.data);
    const auth = await getAuthContext(request, input.companyId);
    requireRole(auth, 'admin', 'operator');
    return listLeaves(input, auth);
  },
);
