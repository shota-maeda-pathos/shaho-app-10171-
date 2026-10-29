import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { CompanyGetSchema } from './schema';
import { getCompany } from './service';

export const companyGet = onCall(async (request) => {
  const input = validate(CompanyGetSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator', 'approver', 'viewer');
  return getCompany(input.companyId, auth);
});
