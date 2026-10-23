import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { EmployeeResignSchema } from './schema';
import { resignEmployee } from './service';

export const employeeResign = onCall(async (request) => {
  const input = validate(EmployeeResignSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return resignEmployee(input, auth);
});
