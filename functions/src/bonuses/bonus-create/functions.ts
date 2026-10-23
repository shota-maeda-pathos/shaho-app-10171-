import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { BonusCreateSchema } from './schema';
import { createBonus } from './service';

export const bonusCreate = onCall(async (request) => {
  const input = validate(BonusCreateSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return createBonus(input, auth);
});
