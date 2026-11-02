import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { calendarDate } from '../../types/catalog-schemas';
import { abolishOffice } from './service';

/** 事業所を廃止する（在籍0人・進行中の手続きなし）。管理者だけ */
export const officeAbolish = onCall(async (request) => {
  const input = validate(z.object({
    companyId: z.string().min(1).regex(/^[^/]+$/), officeId: z.string().min(1).regex(/^[^/]+$/), abolishedOn: calendarDate, expectedVersion: z.number().int().min(1),
  }), request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin');
  return abolishOffice(input, auth);
});
