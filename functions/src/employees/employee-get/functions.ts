import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireLoginEnabled } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { EmployeeGetSchema } from './schema';
import { getEmployee } from './service';

export const employeeGet = onCall(async (request) => {
  const input = validate(EmployeeGetSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireLoginEnabled(auth);
  return getEmployee(input.companyId, input.employeeId, auth);
});
