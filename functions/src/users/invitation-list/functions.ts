import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { InvitationListSchema } from './schema';
import { listInvitations } from './service';

export const invitationList = onCall(async (request) => {
  const input = validate(InvitationListSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin');
  return listInvitations(input, auth);
});
