import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { OfficeCreateSchema } from './schema';
import { createOffice } from './service';

export const officeCreate = onCall(async (request) => {
  const input = validate(OfficeCreateSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return createOffice(input, auth);
});
