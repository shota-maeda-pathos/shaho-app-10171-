import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { GradeRevisionCheckSchema } from './schema';
import { checkGradeRevision } from './service';

export const gradeRevisionCheck = onCall(async (request) => {
  const input = validate(GradeRevisionCheckSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return checkGradeRevision(input, auth);
});
