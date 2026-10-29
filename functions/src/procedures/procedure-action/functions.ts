import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { confirmProcedure } from './service';

const schema = z.object({
  companyId: z.string().regex(/^[^/]+$/), procedureId: z.string().regex(/^[^/]+$/),
  stepId: z.string().min(1), expectedVersion: z.number().int().min(1),
}).strict();
export const procedureAction = onCall(async request => {
  const input = validate(schema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return confirmProcedure(input, auth);
});
