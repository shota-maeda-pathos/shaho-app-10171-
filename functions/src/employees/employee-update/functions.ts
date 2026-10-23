import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { EmployeeUpdateSchema } from './schema';
import { updateEmployee } from './service';

export const employeeUpdate = onCall(async (request) => {
  const input = validate(EmployeeUpdateSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return updateEmployee(input, auth);
});
