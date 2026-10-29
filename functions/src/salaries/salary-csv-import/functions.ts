import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { SalaryCsvImportSchema } from './schema';
import { importSalaryCsv } from './service';

export const salaryCsvImport = onCall(async (request) => {
  const input = validate(SalaryCsvImportSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return importSalaryCsv(input, auth);
});
