import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { OfficeUpdateSchema } from './schema';
import { updateOffice } from './service';

export const officeUpdate = onCall(async (request) => {
  const input = validate(OfficeUpdateSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin');
  return updateOffice(input, auth);
});
