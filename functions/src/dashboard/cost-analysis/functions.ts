import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { getCostAnalysis } from './service';

const schema = z.object({
  companyId: z.string().min(1),
  fiscalYear: z.number().int().min(2000).max(2100),
  officeId: z.string().regex(/^[^/]+$/).optional(),
}).strict();

/** 保険料の分析（年度ごと）。管理者・担当者・閲覧者 */
export const costAnalysis = onCall({ timeoutSeconds: 120, memory: '512MiB' }, async request => {
  const input = validate(schema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator', 'viewer');
  return getCostAnalysis(auth, input.fiscalYear, input.officeId);
});
