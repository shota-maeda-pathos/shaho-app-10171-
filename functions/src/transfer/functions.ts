import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { getAuthContext, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { TransferApplySchema, TransferCompleteSchema, TransferEntrySchema, TransferGetSchema, TransferPreviewSchema, TransferStartSchema } from './schema';
import { applyTransfer, completeTransfer, getTransfer, previewTransfer, saveTransferEntry, startTransfer } from './service';

async function staff(request: { data: unknown; auth?: unknown }, companyId: string) {
  const auth = await getAuthContext(request as Parameters<typeof getAuthContext>[0], companyId);
  requireRole(auth, 'admin', 'operator');
  return auth;
}

/** 事業所間異動を始める */
export const transferStart = onCall(async (request) => {
  const input = validate(TransferStartSchema, request.data);
  return startTransfer(input, await staff(request, input.companyId));
});

export const transferGet = onCall(async (request) => {
  const input = validate(TransferGetSchema, request.data);
  return getTransfer(input.companyId, input.procedureId, await staff(request, input.companyId));
});

/** 異動先と異動日から影響を判定する（保存しない） */
export const transferPreview = onCall(async (request) => {
  const input = validate(TransferPreviewSchema, request.data);
  return previewTransfer(input, await staff(request, input.companyId));
});

/** ウィザードの各ステップの保存。step で操作を選ぶ */
export const transferUpdate = onCall(async (request) => {
  const { step, companyId } = validate(z.object({ step: z.string(), companyId: z.string().min(1).regex(/^[^/]+$/) }).passthrough(), request.data);
  const auth = await staff(request, companyId);
  const data = request.data;
  switch (step) {
    case 'entry': return saveTransferEntry(validate(TransferEntrySchema, data), auth);
    case 'apply': return applyTransfer(validate(TransferApplySchema, data), auth);
    case 'complete': return completeTransfer(validate(TransferCompleteSchema, data), auth);
    default: throw new HttpsError('invalid-argument', '操作が不正です');
  }
});
