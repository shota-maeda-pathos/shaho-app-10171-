import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { CollectionListSchema } from './schema';
import { listCollections } from './service';

export const collectionList = onCall(async (request) => {
  const input = validate(CollectionListSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator', 'approver', 'viewer');
  return listCollections(input, auth);
});
