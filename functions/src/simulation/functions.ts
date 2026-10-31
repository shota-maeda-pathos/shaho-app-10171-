import { CallableRequest, onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { getAuthContext, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validation';
import {
  AnnualSchema, BonusSimSchema, HireSchema, RaiseSchema, RateChangeSchema,
  simulateAnnual, simulateBonus, simulateHire, simulateRaise, simulateRateChange,
} from './scenarios';

/** 試算5種（カタログ13章）。管理者・担当者だけ。実データは書き換えない */
function scenario<S extends z.ZodTypeAny, R>(schema: S, run: (auth: Awaited<ReturnType<typeof getAuthContext>>, input: z.infer<S>) => Promise<R>) {
  return onCall({ timeoutSeconds: 120, memory: '512MiB' }, async (request: CallableRequest) => {
    const input = validate(schema, request.data);
    const auth = await getAuthContext(request, input.companyId);
    requireRole(auth, 'admin', 'operator');
    return run(auth, input);
  });
}

export const simulationRaise = scenario(RaiseSchema, simulateRaise);
export const simulationHire = scenario(HireSchema, simulateHire);
export const simulationAnnual = scenario(AnnualSchema, simulateAnnual);
export const simulationRateChange = scenario(RateChangeSchema, simulateRateChange);
export const simulationBonus = scenario(BonusSimSchema, simulateBonus);
