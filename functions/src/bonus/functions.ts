import { onCall } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { getAuthContext, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validation';
import {
  BonusEntrySchema, BonusFilingGetSchema, BonusFilingUpdateSchema, BonusHoldSchema, BonusImportSchema, BonusJobGetSchema, BonusJobStartSchema,
  BonusNonPaymentSchema, BonusNonPaymentFilingSchema, BonusRunSchema, BonusSampleSchema,
} from './schema';
import {
  bonusOverview, createBonusFiling, getBonusFiling, getBonusJob, importBonus, processBonusChunk, saveBonusEntry, setBonusHold, setBonusNonPayment, createBonusNonPaymentFiling,
  startBonusJob, updateBonusFiling,
} from './service';
import { seedBonusSample } from './sample';

async function staff(request: { data: unknown; auth?: unknown }, companyId: string, withApprover = false) {
  const auth = await getAuthContext(request as Parameters<typeof getAuthContext>[0], companyId);
  if (withApprover) requireRole(auth, 'admin', 'operator', 'approver');
  else requireRole(auth, 'admin', 'operator');
  return auth;
}

/** 事業所×支給月の状況（全員分）。承認者も確認のために開く */
export const bonusRunOverview = onCall({ timeoutSeconds: 120, memory: '512MiB' }, async (request) => {
  const input = validate(BonusRunSchema, request.data);
  return bonusOverview(input, await staff(request, input.companyId, true));
});

export const bonusRunHold = onCall(async (request) => {
  const input = validate(BonusHoldSchema, request.data);
  return setBonusHold(input, await staff(request, input.companyId));
});

export const bonusRunImport = onCall({ timeoutSeconds: 300, memory: '512MiB' }, async (request) => {
  const input = validate(BonusImportSchema, request.data);
  return importBonus(input, await staff(request, input.companyId));
});

export const bonusRunEntry = onCall(async (request) => {
  const input = validate(BonusEntrySchema, request.data);
  return saveBonusEntry(input, await staff(request, input.companyId));
});

export const bonusRunNonPayment = onCall(async (request) => {
  const input = validate(BonusNonPaymentSchema, request.data);
  return setBonusNonPayment(input, await staff(request, input.companyId));
});

/** 一括処理の登録。承認は service で管理者・承認者に限る */
export const bonusJobStart = onCall(async (request) => {
  const input = validate(BonusJobStartSchema, request.data);
  return startBonusJob(input, await staff(request, input.companyId, input.action === 'approveBonus' || input.action === 'approvePremium'));
});

export const bonusJobGet = onCall(async (request) => {
  const input = validate(BonusJobGetSchema, request.data);
  return getBonusJob(input, await staff(request, input.companyId, true));
});

/** 一括処理の本体。Firestore のトリガーはデータベースと同じ地域に置く */
export const bonusJobChunk = onDocumentCreated(
  { document: 'companies/{companyId}/bonusJobs/{jobId}/chunks/{chunkId}', region: 'asia-northeast1', timeoutSeconds: 540, memory: '512MiB' },
  async (event) => {
    await processBonusChunk(event.params.companyId, event.params.jobId, event.params.chunkId);
  },
);

/** 賞与不支給報告書を作る（支給予定月に賞与を払わなかったとき） */
export const bonusNonPaymentFilingCreate = onCall({ timeoutSeconds: 120, memory: '512MiB' }, async (request) => {
  const input = validate(BonusNonPaymentFilingSchema, request.data);
  return createBonusNonPaymentFiling(input, await staff(request, input.companyId));
});

export const bonusFilingCreate = onCall({ timeoutSeconds: 300, memory: '512MiB' }, async (request) => {
  const input = validate(BonusRunSchema, request.data);
  return createBonusFiling(input, await staff(request, input.companyId));
});

/** 届出の承認依頼・承認・差し戻し・取り消し・提出。役割の確認は操作ごとに service で行う */
export const bonusFilingUpdate = onCall(async (request) => {
  const input = validate(BonusFilingUpdateSchema, request.data);
  return updateBonusFiling(input, await staff(request, input.companyId, true));
});

export const bonusFilingGet = onCall(async (request) => {
  const input = validate(BonusFilingGetSchema, request.data);
  return getBonusFiling(input, await staff(request, input.companyId, true));
});

/** 賞与のテスト用の架空の事業所と、前の賞与を作る（管理者だけ） */
export const sampleBonusCreate = onCall({ timeoutSeconds: 300, memory: '512MiB', maxInstances: 1 }, async (request) => {
  const input = validate(BonusSampleSchema, request.data);
  return seedBonusSample(await getAuthContext(request, input.companyId), input.count);
});
