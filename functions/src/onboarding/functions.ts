import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { getAuthContext, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validation';
import {
  CompleteSchema, ContractSchema, HoldSchema, InviteActionSchema, InviteGetSchema, InviteSubmitSchema, OnboardingGetSchema,
  OnboardingListSchema, OnboardingStartSchema, PreviewSchema, RegisterSchema, SubmitFilingSchema,
} from './schema';
import {
  completeOnboarding, getInvite, holdOnboarding, getOnboarding, inviteAction, listOnboarding, previewContract, registerEmployee,
  saveContract, startOnboarding, submitFiling, submitInvite,
} from './service';

async function staff(request: { data: unknown; auth?: unknown }, companyId: string) {
  const auth = await getAuthContext(request as Parameters<typeof getAuthContext>[0], companyId);
  requireRole(auth, 'admin', 'operator');
  return auth;
}

/** 入社手続きを始める（1人、またはまとめて） */
export const onboardingStart = onCall(async (request) => {
  const input = validate(OnboardingStartSchema, request.data);
  return startOnboarding(input, await staff(request, input.companyId));
});

export const onboardingGet = onCall(async (request) => {
  const input = validate(OnboardingGetSchema, request.data);
  return getOnboarding(input.companyId, input.procedureId, await staff(request, input.companyId));
});

export const onboardingList = onCall(async (request) => {
  const input = validate(OnboardingListSchema, request.data);
  return listOnboarding(input, await staff(request, input.companyId));
});

/** 加入の判定と等級の試算（保存しない） */
export const onboardingPreview = onCall(async (request) => {
  const input = validate(PreviewSchema, request.data);
  return previewContract(input, await staff(request, input.companyId));
});

/** ウィザードの各ステップの保存。step で操作を選ぶ */
export const onboardingUpdate = onCall(async (request) => {
  const { step, companyId } = validate(z.object({ step: z.string(), companyId: z.string().min(1).regex(/^[^/]+$/) }).passthrough(), request.data);
  const auth = await staff(request, companyId);
  const data = request.data;
  switch (step) {
    case 'invite': return inviteAction(validate(InviteActionSchema, data), auth);
    case 'register': return registerEmployee(validate(RegisterSchema, data), auth);
    case 'contract': return saveContract(validate(ContractSchema, data), auth);
    case 'filing': return submitFiling(validate(SubmitFilingSchema, data), auth);
    case 'complete': return completeOnboarding(validate(CompleteSchema, data), auth);
    case 'hold': return holdOnboarding(validate(HoldSchema, data), auth);
    default: throw new HttpsError('invalid-argument', '操作が不正です');
  }
});

/** 本人用（ログイン不要）。招待リンクのトークンだけで、その人の入力欄を読み書きする */
export const onboardInviteGet = onCall(async (request) => {
  const input = validate(InviteGetSchema, request.data);
  return getInvite(input.token);
});

export const onboardInviteSubmit = onCall(async (request) => {
  const input = validate(InviteSubmitSchema, request.data);
  return submitInvite(input.token, input.data);
});
