import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { NotificationListSchema } from './schema';
import { listNotifications } from './service';

export const notificationList = onCall(async (request) => {
  const input = validate(NotificationListSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator', 'approver', 'viewer', 'employee');
  return listNotifications(input, auth);
});
