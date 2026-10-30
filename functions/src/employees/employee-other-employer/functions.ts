import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { setOtherEmployer } from './service';

const id = z.string().min(1).regex(/^[^/]+$/);
const Schema = z.object({
  companyId: id,
  employeeId: id,
  otherEmployer: z.object({
    name: z.string().trim().min(1, 'ほかの勤め先の名前を入れてください').max(100),
    since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().transform(v => v ?? null),
    note: z.string().trim().max(200).default(''),
  }).nullable(),
});

/** 二以上事業所勤務の登録・解除（警告を出すためだけの記録） */
export const employeeOtherEmployerSet = onCall(async (request) => {
  const input = validate(Schema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return setOtherEmployer(input, auth);
});
