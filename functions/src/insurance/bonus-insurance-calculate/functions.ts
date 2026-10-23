import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { BonusInsuranceCalculateSchema } from './schema';
import { calculateBonusInsurance } from './service';

export const bonusInsuranceCalculate = onCall(async (request) => {
  const input = validate(BonusInsuranceCalculateSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return calculateBonusInsurance(input, auth);
});
