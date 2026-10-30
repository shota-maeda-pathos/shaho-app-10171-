import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { getAuthContext, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validation';
import {
  ChangeSchema, DecideSchema, RevisionCompleteSchema, RevisionFilingSchema, RevisionGetSchema, RevisionPreviewSchema, RevisionStartSchema,
} from './schema';
import { seedRevisionSample } from './sample';
import { completeRevision, decideRevision, getRevision, previewRevision, saveChange, startRevision, submitRevisionFiling } from './service';

async function staff(request: { data: unknown; auth?: unknown }, companyId: string) {
  const auth = await getAuthContext(request as Parameters<typeof getAuthContext>[0], companyId);
  requireRole(auth, 'admin', 'operator');
  return auth;
}

/** 随時改定・終了時改定の手続きを始める（従業員を選んだところ、毎月の処理の知らせ、産休・育休の完了から） */
export const gradeRevisionStart = onCall(async (request) => {
  const input = validate(RevisionStartSchema, request.data);
  return startRevision(input, await staff(request, input.companyId));
});

export const gradeRevisionGet = onCall(async (request) => {
  const input = validate(RevisionGetSchema, request.data);
  return getRevision(input.companyId, input.procedureId, await staff(request, input.companyId));
});

/** 入力中の変動月・休業の内容で判定する（保存しない） */
export const gradeRevisionPreview = onCall(async (request) => {
  const input = validate(RevisionPreviewSchema, request.data);
  return previewRevision(input, await staff(request, input.companyId));
});

/** ウィザードの各ステップの保存。step で操作を選ぶ */
export const gradeRevisionUpdate = onCall(async (request) => {
  const { step, companyId } = validate(z.object({ step: z.string(), companyId: z.string().min(1).regex(/^[^/]+$/) }).passthrough(), request.data);
  const auth = await staff(request, companyId);
  const data = request.data;
  switch (step) {
    case 'change': return saveChange(validate(ChangeSchema, data), auth);
    case 'decide': return decideRevision(validate(DecideSchema, data), auth);
    case 'filing': return submitRevisionFiling(validate(RevisionFilingSchema, data), auth);
    case 'complete': return completeRevision(validate(RevisionCompleteSchema, data), auth);
    default: throw new HttpsError('invalid-argument', '操作が不正です');
  }
});

/** 随時改定・終了時改定のテスト用の架空の事業所と、給与・等級を作る（管理者だけ） */
export const sampleRevisionCreate = onCall({ timeoutSeconds: 120, maxInstances: 1 }, async (request) => {
  const input = validate(z.object({ companyId: z.string().min(1).regex(/^[^/]+$/) }).strict(), request.data);
  return seedRevisionSample(await getAuthContext(request, input.companyId));
});
