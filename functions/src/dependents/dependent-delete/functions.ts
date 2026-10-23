import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { requireDependentAccess } from '../../middleware/dependent-access';
import { validate } from '../../middleware/validation';
import { DependentDeleteSchema } from './schema';
import { deleteDependent } from './service';

export const dependentDelete = onCall(async (request) => {
  const input = validate(DependentDeleteSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin');
  await requireDependentAccess(auth, input.companyId, input.employeeId);
  return deleteDependent(input, auth);
});
