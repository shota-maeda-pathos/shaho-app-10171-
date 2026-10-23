import { onCall } from 'firebase-functions/v2/https';
import {
  getAuthContext,
  requireRole,
} from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { InsuranceRateListSchema } from './schema';
import { listInsuranceRates } from './service';

export const insuranceRateList = onCall(async (request) => {
  const input = validate(InsuranceRateListSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return listInsuranceRates(input, auth);
});
