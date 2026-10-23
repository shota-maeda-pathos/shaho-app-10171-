import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { SalaryListSchema } from './schema';
import { listSalaries } from './service';

export const salaryList = onCall(async (request) => {
  const input = validate(SalaryListSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return listSalaries(input, auth);
});
