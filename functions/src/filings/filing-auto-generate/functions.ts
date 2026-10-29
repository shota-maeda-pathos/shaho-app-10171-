import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { FilingAutoGenerateSchema } from './schema';
import { autoGenerateFiling } from './service';

export const filingAutoGenerate = onCall(async (request) => {
  const input = validate(FilingAutoGenerateSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return autoGenerateFiling(input, auth);
});
