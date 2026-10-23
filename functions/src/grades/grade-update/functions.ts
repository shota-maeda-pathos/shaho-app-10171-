import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { GradeUpdateSchema } from './schema';
import { updateGrade } from './service';

export const gradeUpdate = onCall(async (request) => {
  const input = validate(GradeUpdateSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return updateGrade(input, auth);
});
