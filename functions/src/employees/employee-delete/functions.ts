import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { EmployeeDeleteSchema } from './schema';
import { deleteEmployee } from './service';

export const employeeDelete = onCall(async (request) => {
  const input = validate(EmployeeDeleteSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return deleteEmployee(input, auth);
});
