import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { CollectionCreateSchema } from './schema';
import { createCollection } from './service';

export const collectionCreate = onCall(async (request) => {
  const input = validate(CollectionCreateSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return createCollection(input, auth);
});
