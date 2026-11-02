import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { EmployeePortalInviteSchema, EmployeePortalStatusSchema } from './schema';
import { getEmployeePortalStatus, inviteEmployeeToPortal } from './service';

export const employeePortalStatus = onCall(async (request) => {
  const input = validate(EmployeePortalStatusSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return getEmployeePortalStatus(input, auth);
});

export const employeePortalInvite = onCall(async (request) => {
  const input = validate(EmployeePortalInviteSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return inviteEmployeeToPortal(input, auth);
});
