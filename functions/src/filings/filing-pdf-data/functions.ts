import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { FilingPdfDataSchema } from './schema';
import { getFilingPdfData } from './service';

export const filingPdfData = onCall(async (request) => {
  const input = validate(FilingPdfDataSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator', 'approver', 'viewer');
  return getFilingPdfData(input, auth);
});
