import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { SalaryCreateSchema } from './schema';
import { createSalary } from './service';

export const salaryCreate = onCall(async (request) => {
  const input = validate(SalaryCreateSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return createSalary(input, auth);
});
