import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { getAuthContext, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { ChangeSchema, CompleteSchema, DependentChangeGetSchema, DependentChangeStartSchema, FilingSchema, PreviewSchema } from './schema';
import { completeDependentChange, getDependentChange, previewItems, saveChange, startDependentChange, submitDependentFiling } from './service';

async function staff(request: { data: unknown; auth?: unknown }, companyId: string) {
  const auth = await getAuthContext(request as Parameters<typeof getAuthContext>[0], companyId);
  requireRole(auth, 'admin', 'operator');
  return auth;
}

/** 扶養の手続きを始める（従業員を選んだところ。台帳は完了時に変える） */
export const dependentChangeStart = onCall(async (request) => {
  const input = validate(DependentChangeStartSchema, request.data);
  return startDependentChange(input, await staff(request, input.companyId));
});

export const dependentChangeGet = onCall(async (request) => {
  const input = validate(DependentChangeGetSchema, request.data);
  return getDependentChange(input.companyId, input.procedureId, await staff(request, input.companyId));
});

/** 入力中の内容の判定（収入要件・期限・添付書類。保存しない） */
export const dependentChangePreview = onCall(async (request) => {
  const input = validate(PreviewSchema, request.data);
  return previewItems(input, await staff(request, input.companyId));
});

/** ウィザードの各ステップの保存。step で操作を選ぶ */
export const dependentChangeUpdate = onCall(async (request) => {
  const { step, companyId } = validate(z.object({ step: z.string(), companyId: z.string().min(1).regex(/^[^/]+$/) }).passthrough(), request.data);
  const auth = await staff(request, companyId);
  const data = request.data;
  switch (step) {
    case 'change': return saveChange(validate(ChangeSchema, data), auth);
    case 'filing': return submitDependentFiling(validate(FilingSchema, data), auth);
    case 'complete': return completeDependentChange(validate(CompleteSchema, data), auth);
    default: throw new HttpsError('invalid-argument', '操作が不正です');
  }
});
