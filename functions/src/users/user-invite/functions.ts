import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { UserInviteSchema } from './schema';
import { inviteUser } from './service';

export const userInvite = onCall(async (request) => {
  const input = validate(UserInviteSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin');
  return inviteUser(input, auth);
});
