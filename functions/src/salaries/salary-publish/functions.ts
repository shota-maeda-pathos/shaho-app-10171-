import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { SalaryPublishSchema } from './schema';
import { publishSalaries } from './service';

export const salaryPublish = onCall(async (request) => {
  const input = validate(SalaryPublishSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return publishSalaries(input, auth);
});
