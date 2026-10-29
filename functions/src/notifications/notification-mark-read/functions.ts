import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { NotificationMarkReadSchema } from './schema';
import { markNotificationsRead } from './service';

export const notificationMarkRead = onCall(async (request) => {
  const input = validate(NotificationMarkReadSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator', 'approver', 'viewer', 'employee');
  return markNotificationsRead(input, auth);
});
