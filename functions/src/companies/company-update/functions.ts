import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { CompanyUpdateSchema } from './schema';
import { updateCompany } from './service';

export const companyUpdate = onCall(async (request) => {
  const input = validate(CompanyUpdateSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin');
  return updateCompany(input, auth);
});
