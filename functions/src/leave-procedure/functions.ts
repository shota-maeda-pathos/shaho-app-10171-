import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { getAuthContext, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { CompleteSchema, EventSchema, FilingSchema, LeaveGetSchema, LeaveStartSchema, PlanSchema, PreviewSchema } from './schema';
import { completeLeave, getLeave, previewLeave, recordLeaveEvent, savePlan, startLeave, submitLeaveFiling } from './service';

async function staff(request: { data: unknown; auth?: unknown }, companyId: string) {
  const auth = await getAuthContext(request as Parameters<typeof getAuthContext>[0], companyId);
  requireRole(auth, 'admin', 'operator');
  return auth;
}

/** 産休・育休の手続きを始める（従業員と休業の種類を選んだところ） */
export const leaveProcedureStart = onCall(async (request) => {
  const input = validate(LeaveStartSchema, request.data);
  return startLeave(input, await staff(request, input.companyId));
});

export const leaveProcedureGet = onCall(async (request) => {
  const input = validate(LeaveGetSchema, request.data);
  return getLeave(input.companyId, input.procedureId, await staff(request, input.companyId));
});

/** 入力中の期間・休業中のことの判定（免除の月・期限・出す届出。保存しない） */
export const leaveProcedurePreview = onCall(async (request) => {
  const input = validate(PreviewSchema, request.data);
  return previewLeave(input, await staff(request, input.companyId));
});

/** ウィザードの各ステップの保存。step で操作を選ぶ */
export const leaveProcedureUpdate = onCall(async (request) => {
  const { step, companyId } = validate(z.object({ step: z.string(), companyId: z.string().min(1).regex(/^[^/]+$/) }).passthrough(), request.data);
  const auth = await staff(request, companyId);
  const data = request.data;
  switch (step) {
    case 'plan': return savePlan(validate(PlanSchema, data), auth);
    case 'filing': return submitLeaveFiling(validate(FilingSchema, data), auth);
    case 'event': return recordLeaveEvent(validate(EventSchema, data), auth);
    case 'complete': return completeLeave(validate(CompleteSchema, data), auth);
    default: throw new HttpsError('invalid-argument', '操作が不正です');
  }
});
