import { onCall } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { getAuthContext, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validation';
import {
  SanteiDecisionSchema, SanteiFilingCreateSchema, SanteiFilingGetSchema, SanteiFilingUpdateSchema, SanteiHoldSchema, SanteiJobGetSchema,
  SanteiJobStartSchema, SanteiRunSchema, SanteiSampleSchema,
} from './schema';
import {
  createSanteiFiling, getSanteiFiling, getSanteiJob, processSanteiChunk, santeiOverview, setSanteiDecision, setSanteiHold, startSanteiJob,
  updateSanteiFiling,
} from './service';
import { seedSanteiSample } from './sample';

async function staff(request: { data: unknown; auth?: unknown }, companyId: string, withApprover = false) {
  const auth = await getAuthContext(request as Parameters<typeof getAuthContext>[0], companyId);
  if (withApprover) requireRole(auth, 'admin', 'operator', 'approver');
  else requireRole(auth, 'admin', 'operator');
  return auth;
}

/** 事業所×年の状況（全員分）。承認者も確認のために開く */
export const santeiRunOverview = onCall({ timeoutSeconds: 120, memory: '512MiB' }, async (request) => {
  const input = validate(SanteiRunSchema, request.data);
  return santeiOverview(input, await staff(request, input.companyId, true));
});

export const santeiRunHold = onCall(async (request) => {
  const input = validate(SanteiHoldSchema, request.data);
  return setSanteiHold(input, await staff(request, input.companyId));
});

export const santeiDecision = onCall(async (request) => {
  const input = validate(SanteiDecisionSchema, request.data);
  return setSanteiDecision(input, await staff(request, input.companyId));
});

/** 一括処理の登録。承認はここで管理者・承認者に限る */
export const santeiJobStart = onCall(async (request) => {
  const input = validate(SanteiJobStartSchema, request.data);
  return startSanteiJob(input, await staff(request, input.companyId, input.action === 'approveGrade'));
});

export const santeiJobGet = onCall(async (request) => {
  const input = validate(SanteiJobGetSchema, request.data);
  return getSanteiJob(input, await staff(request, input.companyId, true));
});

/** 一括処理の本体。Firestore のトリガーはデータベースと同じ地域に置く */
export const santeiJobChunk = onDocumentCreated(
  { document: 'companies/{companyId}/santeiJobs/{jobId}/chunks/{chunkId}', region: 'asia-northeast1', timeoutSeconds: 540, memory: '512MiB' },
  async (event) => {
    await processSanteiChunk(event.params.companyId, event.params.jobId, event.params.chunkId);
  },
);

export const santeiFilingCreate = onCall({ timeoutSeconds: 300, memory: '512MiB' }, async (request) => {
  const input = validate(SanteiFilingCreateSchema, request.data);
  return createSanteiFiling(input, await staff(request, input.companyId));
});

/** 届出の承認依頼・承認・差し戻し・取り消し・提出。役割の確認は操作ごとに service で行う */
export const santeiFilingUpdate = onCall(async (request) => {
  const input = validate(SanteiFilingUpdateSchema, request.data);
  return updateSanteiFiling(input, await staff(request, input.companyId, true));
});

export const santeiFilingGet = onCall(async (request) => {
  const input = validate(SanteiFilingGetSchema, request.data);
  return getSanteiFiling(input, await staff(request, input.companyId, true));
});

/** 算定のテスト用の架空の事業所と、4〜6月の承認済みの給与を作る（管理者だけ） */
export const sampleSanteiCreate = onCall({ timeoutSeconds: 300, memory: '512MiB', maxInstances: 1 }, async (request) => {
  const input = validate(SanteiSampleSchema, request.data);
  return seedSanteiSample(await getAuthContext(request, input.companyId), input.count);
});
