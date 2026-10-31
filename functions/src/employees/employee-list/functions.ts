import { onCall } from 'firebase-functions/v2/https';
import { auditAccess } from '../../utils/audit';
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
  const data = await listEmployees(input, auth);
  if (input.keyword) await auditAccess(auth, 'employee', 'search', 'search', { keyword: input.keyword });
  return data;
});
