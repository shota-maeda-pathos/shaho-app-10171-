import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { UserUpdateRoleSchema } from './schema';
import { updateUserRole } from './service';

export const userUpdateRole = onCall(async (request) => {
  const input = validate(UserUpdateRoleSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin');
  return updateUserRole(input, auth);
});
