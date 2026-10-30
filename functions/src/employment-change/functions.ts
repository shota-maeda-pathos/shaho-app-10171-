import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { getAuthContext, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { ChangeCompleteSchema, ChangeEntrySchema, ChangeFilingSchema, ChangeGetSchema, ChangePreviewSchema, ChangeStartSchema } from './schema';
import {
  completeEmploymentChange, getEmploymentChange, previewEmploymentChange, saveEmploymentEntry, startEmploymentChange, submitChangeFiling,
} from './service';
import { seedChangeSample } from './sample';

async function staff(request: { data: unknown; auth?: unknown }, companyId: string) {
  const auth = await getAuthContext(request as Parameters<typeof getAuthContext>[0], companyId);
  requireRole(auth, 'admin', 'operator');
  return auth;
}

/** 雇用条件の変更（有期契約の更新を含む）を始める */
export const employmentChangeStart = onCall(async (request) => {
  const input = validate(ChangeStartSchema, request.data);
  return startEmploymentChange(input, await staff(request, input.companyId));
});

export const employmentChangeGet = onCall(async (request) => {
  const input = validate(ChangeGetSchema, request.data);
  return getEmploymentChange(input.companyId, input.procedureId, await staff(request, input.companyId));
});

/** 入れかけの雇用条件で加入の判定をする（保存しない） */
export const employmentChangePreview = onCall(async (request) => {
  const input = validate(ChangePreviewSchema, request.data);
  return previewEmploymentChange(input, await staff(request, input.companyId));
});

/** ウィザードの各ステップの保存。step で操作を選ぶ */
export const employmentChangeUpdate = onCall(async (request) => {
  const { step, companyId } = validate(z.object({ step: z.string(), companyId: z.string().min(1).regex(/^[^/]+$/) }).passthrough(), request.data);
  const auth = await staff(request, companyId);
  const data = request.data;
  switch (step) {
    case 'entry': return saveEmploymentEntry(validate(ChangeEntrySchema, data), auth);
    case 'filing': return submitChangeFiling(validate(ChangeFilingSchema, data), auth);
    case 'complete': return completeEmploymentChange(validate(ChangeCompleteSchema, data), auth);
    default: throw new HttpsError('invalid-argument', '操作が不正です');
  }
});

/** 雇用条件の変更・有期雇用・事業所間異動のテスト用の架空の事業所と従業員を作る（管理者だけ） */
export const sampleChangeCreate = onCall({ timeoutSeconds: 120, maxInstances: 1 }, async (request) => {
  const input = validate(z.object({ companyId: z.string().min(1).regex(/^[^/]+$/) }).strict(), request.data);
  return seedChangeSample(await getAuthContext(request, input.companyId));
});
