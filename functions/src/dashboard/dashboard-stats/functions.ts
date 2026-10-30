import { onCall } from 'firebase-functions/v2/https';
import { dashboardStatsSchema } from './schema';
import { getDashboardStats } from './service';
import { getAuthContext, requireRole } from '../../middleware/auth';

export const dashboardStats = onCall(
  async (request) => {
    const input = dashboardStatsSchema.parse(request.data);
    const auth = await getAuthContext(request, input.companyId);
    requireRole(auth, 'admin', 'operator');
    return getDashboardStats(auth, input.officeId);
  },
);
