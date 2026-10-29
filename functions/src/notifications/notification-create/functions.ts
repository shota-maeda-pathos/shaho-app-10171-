import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { NotificationCreateSchema } from './schema';
import { createNotification } from './service';

export const notificationCreate = onCall(async (request) => {
  const input = validate(NotificationCreateSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return createNotification(input, auth);
});
