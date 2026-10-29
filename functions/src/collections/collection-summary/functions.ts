import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { CollectionSummarySchema } from './schema';
import { getCollectionSummary } from './service';

export const collectionSummary = onCall(async (request) => {
  const input = validate(CollectionSummarySchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator', 'approver', 'viewer');
  return getCollectionSummary(input, auth);
});
