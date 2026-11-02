import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { EmployeeCsvImportSchema } from './schema';
import { importEmployeeCsv } from './service';

/** 従業員CSVの確認（dryRun）と一括登録・更新 */
export const employeeCsvImport = onCall({ timeoutSeconds: 540, memory: '512MiB' }, async (request) => {
  const input = validate(EmployeeCsvImportSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return importEmployeeCsv(input, auth);
});
