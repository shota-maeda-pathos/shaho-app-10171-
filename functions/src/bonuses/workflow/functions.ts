import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { bonusGetSchema, bonusUpdateSchema } from './schema';
import { getBonus, updateBonus } from './service';
export const bonusGet = onCall(async request => {
  const input = validate(bonusGetSchema, request.data);
  return getBonus(input, await getAuthContext(request, input.companyId));
});
export const bonusUpdate = onCall(async request => {
  const input = validate(bonusUpdateSchema, request.data);
  return updateBonus(input, await getAuthContext(request, input.companyId));
});
