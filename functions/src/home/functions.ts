import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { getAuthContext, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { listHomeTodos } from './service';

const id = z.string().min(1).max(200).regex(/^[^/]+$/);
const HomeTodosSchema = z.object({ companyId: id, officeId: id.optional() }).strict();

/** ホームのやることリスト */
export const homeTodos = onCall(async (request) => {
  const input = validate(HomeTodosSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator', 'approver');
  return listHomeTodos(auth, input.officeId);
});
