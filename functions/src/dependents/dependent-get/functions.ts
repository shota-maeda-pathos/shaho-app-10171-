import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext } from '../../middleware/auth';
import { requireDependentReadAccess } from '../../middleware/dependent-access';
import { validate } from '../../middleware/validation';
import { DependentGetSchema } from './schema';
import { getDependent } from './service';

export const dependentGet = onCall(async (request) => {
  const input = validate(DependentGetSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  await requireDependentReadAccess(auth, input.companyId, input.employeeId);
  return getDependent(
    input.companyId,
    input.employeeId,
    input.dependentId,
    auth,
  );
});
