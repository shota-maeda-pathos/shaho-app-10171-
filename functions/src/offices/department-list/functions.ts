import { onCall } from 'firebase-functions/v2/https';
import {
  getAuthContext,
  requireRole,
} from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { DepartmentListSchema } from './schema';
import { listDepartments } from './service';

export const departmentList = onCall(async (request) => {
  const input = validate(DepartmentListSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator', 'approver', 'viewer');
  return listDepartments(input, auth);
});
