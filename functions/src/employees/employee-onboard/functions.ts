import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { EmployeeOnboardSchema } from './schema';
import { onboardEmployee } from './service';

export const employeeOnboard = onCall(async (request) => {
  const input = validate(EmployeeOnboardSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return onboardEmployee(input, auth);
});
