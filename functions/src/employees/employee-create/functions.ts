import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { EmployeeCreateSchema } from './schema';
import { createEmployee } from './service';

export const employeeCreate = onCall(async (request) => {
  const input = validate(EmployeeCreateSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return createEmployee(input, auth);
});
