import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext } from '../../middleware/auth';
import { requireDependentReadAccess } from '../../middleware/dependent-access';
import { validate } from '../../middleware/validation';
import { DependentListSchema } from './schema';
import { listDependents } from './service';

export const dependentList = onCall(async (request) => {
  const input = validate(DependentListSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  await requireDependentReadAccess(auth, input.companyId, input.employeeId);
  return listDependents(input, auth);
});
