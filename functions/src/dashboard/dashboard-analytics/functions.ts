import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { DashboardAnalyticsSchema } from './schema';
import { getDashboardAnalytics } from './service';

export const dashboardAnalytics = onCall(async (request) => {
  const input = validate(DashboardAnalyticsSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return getDashboardAnalytics(input, auth);
});
