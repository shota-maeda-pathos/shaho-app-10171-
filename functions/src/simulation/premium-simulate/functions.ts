import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { PremiumSimulateSchema } from './schema';
import { simulatePremium } from './service';

export const premiumSimulate = onCall(async (request) => {
  const input = validate(PremiumSimulateSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator', 'viewer');
  return simulatePremium(input, auth);
});
