import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { SecretsGetSchema, SecretsUpdateSchema } from './schema';
import { getSecrets, updateSecrets } from './service';

export const employeeSecretsGet = onCall(async (request) => {
  const input = validate(SecretsGetSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin');
  return getSecrets(input, auth);
});

export const employeeSecretsUpdate = onCall(async (request) => {
  const input = validate(SecretsUpdateSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin');
  return updateSecrets(input, auth);
});
