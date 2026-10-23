import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext } from '../../middleware/auth';
import { requireDependentAccess } from '../../middleware/dependent-access';
import { validate } from '../../middleware/validation';
import { DependentUpdateSchema } from './schema';
import { updateDependent } from './service';

export const dependentUpdate = onCall(async (request) => {
  const input = validate(DependentUpdateSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  await requireDependentAccess(auth, input.companyId, input.employeeId);
  return updateDependent(input, auth);
});
