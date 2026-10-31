import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { SecretsGetSchema, SecretsRevealSchema, SecretsUpdateSchema } from './schema';
import { getSecrets, revealSecrets, updateSecrets } from './service';

// 個人番号を扱えるのは管理者と労務担当者（担当事業所だけ）
export const employeeSecretsGet = onCall(async (request) => {
  const input = validate(SecretsGetSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return getSecrets(input, auth);
});

export const employeeSecretsUpdate = onCall(async (request) => {
  const input = validate(SecretsUpdateSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return updateSecrets(input, auth);
});

export const employeeSecretsReveal = onCall(async (request) => {
  const input = validate(SecretsRevealSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return revealSecrets(input, auth);
});
