import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { getAuthContext, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { AgeCheckSchema, AgeCompleteSchema, AgeFilingSchema, AgeGetSchema, AgePreviewSchema, AgeStartSchema } from './schema';
import { completeAgeEvent, getAgeEvent, previewAgeEvent, saveAgeCheck, startAgeEvent, submitAgeFiling } from './service';
import { seedAgeSample } from './sample';

async function staff(request: { data: unknown; auth?: unknown }, companyId: string) {
  const auth = await getAuthContext(request as Parameters<typeof getAuthContext>[0], companyId);
  requireRole(auth, 'admin', 'operator');
  return auth;
}

/** 年齢到達（70歳・75歳）の手続きを始める（ホームのやること・手続きを始めるから） */
export const ageEventStart = onCall(async (request) => {
  const input = validate(AgeStartSchema, request.data);
  return startAgeEvent(input, await staff(request, input.companyId));
});

export const ageEventGet = onCall(async (request) => {
  const input = validate(AgeGetSchema, request.data);
  return getAgeEvent(input.companyId, input.procedureId, await staff(request, input.companyId));
});

/** 70歳：入れかけの報酬月額で届出の要否を判定する（保存しない） */
export const ageEventPreview = onCall(async (request) => {
  const input = validate(AgePreviewSchema, request.data);
  return previewAgeEvent(input, await staff(request, input.companyId));
});

/** ウィザードの各ステップの保存。step で操作を選ぶ */
export const ageEventUpdate = onCall(async (request) => {
  const { step, companyId } = validate(z.object({ step: z.string(), companyId: z.string().min(1).regex(/^[^/]+$/) }).passthrough(), request.data);
  const auth = await staff(request, companyId);
  const data = request.data;
  switch (step) {
    case 'check': return saveAgeCheck(validate(AgeCheckSchema, data), auth);
    case 'filing': return submitAgeFiling(validate(AgeFilingSchema, data), auth);
    case 'complete': return completeAgeEvent(validate(AgeCompleteSchema, data), auth);
    default: throw new HttpsError('invalid-argument', '操作が不正です');
  }
});

/** 年齢到達のテスト用の架空の事業所と従業員を作る（管理者だけ） */
export const sampleAgeCreate = onCall({ timeoutSeconds: 120, maxInstances: 1 }, async (request) => {
  const input = validate(z.object({ companyId: z.string().min(1).regex(/^[^/]+$/) }).strict(), request.data);
  return seedAgeSample(await getAuthContext(request, input.companyId));
});
