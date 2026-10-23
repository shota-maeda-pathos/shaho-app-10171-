import { onCall } from 'firebase-functions/v2/https';
import { validate } from '../../middleware/validation';
import { getAuthContext, requireLoginEnabled, requireNotSuspended, requireRole } from '../../middleware/auth';
import { FilingRecordResultSchema } from './schema';
import { recordFilingResult } from './service';

export const filingRecordResult = onCall(async (request) => {
  const input = validate(FilingRecordResultSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireLoginEnabled(auth);
  requireNotSuspended(auth);
  requireRole(auth, 'admin', 'operator');
  return recordFilingResult(input, auth);
});
