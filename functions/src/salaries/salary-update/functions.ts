import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { SalaryUpdateSchema } from './schema';
import { updateSalary } from './service';

export const salaryUpdate = onCall(async (request) => {
  const input = validate(SalaryUpdateSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return updateSalary(input, auth);
});
