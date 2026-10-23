import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { UserListSchema } from './schema';
import { listUsers } from './service';

export const userList = onCall(async (request) => {
  const input = validate(UserListSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin');
  return listUsers(auth);
});
