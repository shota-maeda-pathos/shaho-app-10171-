import { onCall } from 'firebase-functions/v2/https';
import { validate } from '../../middleware/validation';
import { getAuthContext, requireLoginEnabled, requireNotSuspended, requireRole } from '../../middleware/auth';
import { FilingGetSchema } from './schema';
import { getFiling } from './service';

export const filingGet = onCall(async (request) => {
  const input = validate(FilingGetSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireLoginEnabled(auth);
  requireNotSuspended(auth);
  // 承認者も承認する前に中身を確かめる（事業所の範囲は getFiling で確かめる）
  requireRole(auth, 'admin', 'operator', 'approver');
  return getFiling(input, auth);
});
