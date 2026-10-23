import { onCall } from 'firebase-functions/v2/https';
import {
  getAuthContext,
  requireLoginEnabled,
  requireNotSuspended,
  requireRole,
} from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { EmployeeListSchema } from './schema';
import { listEmployees } from './service';

export const employeeList = onCall(async (request) => {
  const input = validate(EmployeeListSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireLoginEnabled(auth);
  requireNotSuspended(auth);
  requireRole(auth, 'admin', 'operator', 'approver', 'viewer');
  return listEmployees(input, auth);
});
