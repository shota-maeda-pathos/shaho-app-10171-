import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { GradeCreateSchema } from './schema';
import { createGrade } from './service';

export const gradeCreate = onCall(async (request) => {
  const input = validate(GradeCreateSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return createGrade(input, auth);
});
