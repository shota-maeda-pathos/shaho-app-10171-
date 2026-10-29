import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { getAuthContext, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validation';
import {
  AccountSchema, CompleteSchema, EntrySchema, LossFilingSchema, ResignationGetSchema, ResignationPreviewSchema,
  ResignationStartSchema, SettlementPreviewSchema, SettlementSchema,
} from './schema';
import {
  completeResignation, getResignation, previewEntry, previewSettlement, saveAccount, saveEntry, saveSettlement,
  startResignation, submitLossFiling,
} from './service';

async function staff(request: { data: unknown; auth?: unknown }, companyId: string) {
  const auth = await getAuthContext(request as Parameters<typeof getAuthContext>[0], companyId);
  requireRole(auth, 'admin', 'operator');
  return auth;
}

/** 退職手続きを始める（従業員を選んだところ。台帳はまだ変えない） */
export const resignationStart = onCall(async (request) => {
  const input = validate(ResignationStartSchema, request.data);
  return startResignation(input, await staff(request, input.companyId));
});

export const resignationGet = onCall(async (request) => {
  const input = validate(ResignationGetSchema, request.data);
  return getResignation(input.companyId, input.procedureId, await staff(request, input.companyId));
});

/** 退職日から決まること・最後の保険料の集め方の試算（保存しない）。kind で選ぶ */
export const resignationPreview = onCall(async (request) => {
  const { kind, companyId } = validate(z.object({ kind: z.enum(['entry', 'settlement']), companyId: z.string().min(1).regex(/^[^/]+$/) }).passthrough(), request.data);
  const auth = await staff(request, companyId);
  return kind === 'entry'
    ? previewEntry(validate(ResignationPreviewSchema, request.data), auth)
    : previewSettlement(validate(SettlementPreviewSchema, request.data), auth);
});

/** ウィザードの各ステップの保存。step で操作を選ぶ */
export const resignationUpdate = onCall(async (request) => {
  const { step, companyId } = validate(z.object({ step: z.string(), companyId: z.string().min(1).regex(/^[^/]+$/) }).passthrough(), request.data);
  const auth = await staff(request, companyId);
  const data = request.data;
  switch (step) {
    case 'entry': return saveEntry(validate(EntrySchema, data), auth);
    case 'settlement': return saveSettlement(validate(SettlementSchema, data), auth);
    case 'account': return saveAccount(validate(AccountSchema, data), auth);
    case 'filing': return submitLossFiling(validate(LossFilingSchema, data), auth);
    case 'complete': return completeResignation(validate(CompleteSchema, data), auth);
    default: throw new HttpsError('invalid-argument', '操作が不正です');
  }
});
