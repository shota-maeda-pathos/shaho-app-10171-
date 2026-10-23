import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { MonthlyInsuranceCalculateSchema } from './schema';
import { calculateMonthlyInsurance } from './service';

export const monthlyInsuranceCalculate = onCall(async (request) => {
  const input = validate(MonthlyInsuranceCalculateSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return calculateMonthlyInsurance(input, auth);
});
