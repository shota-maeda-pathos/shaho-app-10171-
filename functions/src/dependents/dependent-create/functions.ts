import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext } from '../../middleware/auth';
import { requireDependentAccess } from '../../middleware/dependent-access';
import { validate } from '../../middleware/validation';
import { DependentCreateSchema } from './schema';
import { createDependent } from './service';

export const dependentCreate = onCall(async (request) => {
  const input = validate(DependentCreateSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  await requireDependentAccess(auth, input.companyId, input.employeeId);
  return createDependent(input, auth);
});
