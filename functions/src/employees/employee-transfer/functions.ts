import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { EmployeeTransferSchema } from './schema';
import { transferEmployee } from './service';

export const employeeTransfer = onCall(async (request) => {
  const input = validate(EmployeeTransferSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return transferEmployee(input, auth);
});
