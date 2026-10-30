import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { employeeHistoryListSchema } from './schema';
import { listEmployeeHistory } from './service';
export const employeeHistoryList = onCall(async request => {
 const input = validate(employeeHistoryListSchema, request.data);
 const auth = await getAuthContext(request, input.companyId);
 requireRole(auth, 'admin', 'operator');
 return listEmployeeHistory(input, auth);
});
