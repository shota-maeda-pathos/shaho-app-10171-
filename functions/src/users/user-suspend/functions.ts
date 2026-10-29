import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { UserSuspendSchema, UserDisableLoginSchema } from './schema';
import { suspendUser, unsuspendUser, disableUserLogin } from './service';

export const userSuspend = onCall(async (request) => {
  const input = validate(UserSuspendSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin');
  return suspendUser(input, auth);
});

export const userUnsuspend = onCall(async (request) => {
  const input = validate(UserSuspendSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin');
  return unsuspendUser(input, auth);
});

export const userDisableLogin = onCall(async (request) => {
  const input = validate(UserDisableLoginSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin');
  return disableUserLogin(input, auth);
});
