import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { EmploymentCreateSchema } from './schema';
import { createEmployment } from './service';

export const employmentCreate = onCall(async (request) => {
  const input = validate(EmploymentCreateSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return createEmployment(input, auth);
});
