import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { listStaffNotifications } from './service';

const Schema = z.object({ companyId: z.string().min(1), limit: z.number().int().min(1).max(50).default(10) }).strict();

/** ホームに出すスタッフ向けのお知らせ（管理者・担当者・承認者） */
export const staffNotificationList = onCall(async (request) => {
  const input = validate(Schema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator', 'approver');
  return listStaffNotifications(auth, input.limit);
});
