import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { getAuthContext, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validation';
import {
  GradeCorrectionCorrectSchema, GradeCorrectionEntrySchema, GradeCorrectionGetSchema, GradeCorrectionPreviewSchema, GradeCorrectionSettleSchema, GradeCorrectionStartSchema,
} from './schema';
import { correctMonths, getGradeCorrection, previewGradeCorrection, saveCorrectionEntry, settleCorrection, startGradeCorrection } from './service';

async function staff(request: { data: unknown; auth?: unknown }, companyId: string) {
  const auth = await getAuthContext(request as Parameters<typeof getAuthContext>[0], companyId);
  requireRole(auth, 'admin', 'operator');
  return auth;
}

/** 等級の遡及訂正（修正等級を含む）を始める */
export const gradeCorrectionStart = onCall(async (request) => {
  const input = validate(GradeCorrectionStartSchema, request.data);
  return startGradeCorrection(input, await staff(request, input.companyId));
});

export const gradeCorrectionGet = onCall(async (request) => {
  const input = validate(GradeCorrectionGetSchema, request.data);
  return getGradeCorrection(input.companyId, input.procedureId, await staff(request, input.companyId));
});

/** 直す等級から、影響する月・差額・関係する届出を出す（保存しない） */
export const gradeCorrectionPreview = onCall(async (request) => {
  const input = validate(GradeCorrectionPreviewSchema, request.data);
  return previewGradeCorrection(input, await staff(request, input.companyId));
});

/** ウィザードの各ステップの保存。step で操作を選ぶ */
export const gradeCorrectionUpdate = onCall(async (request) => {
  const { step, companyId } = validate(z.object({ step: z.string(), companyId: z.string().min(1).regex(/^[^/]+$/) }).passthrough(), request.data);
  const auth = await staff(request, companyId);
  const data = request.data;
  switch (step) {
    case 'entry': return saveCorrectionEntry(validate(GradeCorrectionEntrySchema, data), auth);
    case 'correct': return correctMonths(validate(GradeCorrectionCorrectSchema, data), auth);
    case 'settle': return settleCorrection(validate(GradeCorrectionSettleSchema, data), auth);
    default: throw new HttpsError('invalid-argument', '操作が不正です');
  }
});
