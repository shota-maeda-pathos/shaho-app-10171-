import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { RunCorrectionCreateSchema, RunCorrectionUpdateSchema } from './schema';
import { createRunCorrection, updateRunCorrection } from './service';

/** 提出済みの算定基礎届・賞与支払届から、選んだ人の訂正届・取消届を作る */
export const runCorrectionCreate = onCall(async (request) => {
  const input = validate(RunCorrectionCreateSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return createRunCorrection(input, auth);
});

/** 算定基礎届・賞与支払届の訂正届の行・理由を直す */
export const runCorrectionUpdate = onCall(async (request) => {
  const input = validate(RunCorrectionUpdateSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return updateRunCorrection(input, auth);
});
