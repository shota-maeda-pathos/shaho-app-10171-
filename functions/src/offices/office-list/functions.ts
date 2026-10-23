import { onCall } from 'firebase-functions/v2/https';
import {
  getAuthContext,
  requireRole,
} from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { OfficeListSchema } from './schema';
import { listOffices } from './service';

export const officeList = onCall(async (request) => {
  const input = validate(OfficeListSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator', 'approver', 'viewer');
  return listOffices(input, auth);
});
