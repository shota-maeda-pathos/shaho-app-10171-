import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { CorrectionCreateSchema, CorrectionUpdateSchema } from './schema';
import { createCorrection, updateCorrection } from './service';

/** 提出済みの届出から訂正届・取消届を作る */
export const filingCorrectionCreate = onCall(async (request) => {
  const input = validate(CorrectionCreateSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return createCorrection(input, auth);
});

/** 訂正届の記入内容・理由を直す／取り下げる */
export const filingCorrectionUpdate = onCall(async (request) => {
  const input = validate(CorrectionUpdateSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return updateCorrection(input, auth);
});
