import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { monthlyInsuranceGetSchema } from './schema';
import { getMonthlyInsurance } from './service';
export const monthlyInsuranceGet = onCall({ region: 'us-central1' }, async request => {
 const input = validate(monthlyInsuranceGetSchema, request.data);
 const auth = await getAuthContext(request, input.companyId);
 requireRole(auth, 'admin', 'operator');
 return getMonthlyInsurance(input, auth);
});
