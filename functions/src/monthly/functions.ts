import { onCall } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { getAuthContext, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { CollectionEntrySchema, HoldSchema, ImportSchema, JobGetSchema, JobStartSchema, NoPaySchema, RunSchema, SalaryItemsSchema } from './schema';
import {
  addCollectionEntry, getMonthlyJob, importMonthlySalary, markNoPay, monthlyOverview, processMonthlyChunk, setMonthlyHold, startMonthlyJob,
  updateSalaryItems,
} from './service';

async function staff(request: { data: unknown; auth?: unknown }, companyId: string, withApprover = false) {
  const auth = await getAuthContext(request as Parameters<typeof getAuthContext>[0], companyId);
  if (withApprover) requireRole(auth, 'admin', 'operator', 'approver');
  else requireRole(auth, 'admin', 'operator');
  return auth;
}

/** 事業所・支給月の状況（全員分）。承認者も確認のために開く */
export const monthlyRunOverview = onCall({ timeoutSeconds: 120, memory: '512MiB' }, async (request) => {
  const input = validate(RunSchema, request.data);
  return monthlyOverview(input, await staff(request, input.companyId, true));
});

export const monthlyRunHold = onCall(async (request) => {
  const input = validate(HoldSchema, request.data);
  return setMonthlyHold(input, await staff(request, input.companyId));
});

/** 給与CSVの確認（dryRun）と取込 */
export const monthlySalaryImport = onCall({ timeoutSeconds: 300, memory: '512MiB' }, async (request) => {
  const input = validate(ImportSchema, request.data);
  return importMonthlySalary(input, await staff(request, input.companyId));
});

export const monthlySalaryNoPay = onCall(async (request) => {
  const input = validate(NoPaySchema, request.data);
  return markNoPay(input, await staff(request, input.companyId));
});

/** 給与項目マスタ（CSVの列名と、固定的／非固定的の区分）の保存 */
export const monthlySalaryItemsUpdate = onCall(async (request) => {
  const input = validate(SalaryItemsSchema, request.data);
  return updateSalaryItems(input, await staff(request, input.companyId));
});

export const monthlyCollectionEntry = onCall(async (request) => {
  const input = validate(CollectionEntrySchema, request.data);
  return addCollectionEntry(input, await staff(request, input.companyId));
});

/** 一括処理の登録。承認はここで管理者・承認者に限る */
export const monthlyJobStart = onCall(async (request) => {
  const input = validate(JobStartSchema, request.data);
  const approve = input.action === 'approveSalary' || input.action === 'approvePremium';
  return startMonthlyJob(input, await staff(request, input.companyId, approve));
});

export const monthlyJobGet = onCall(async (request) => {
  const input = validate(JobGetSchema, request.data);
  return getMonthlyJob(input, await staff(request, input.companyId, true));
});

/** 一括処理の本体。25名ずつの chunk ごとに並行して動く。Firestore のトリガーはデータベースと同じ地域に置く */
export const monthlyJobChunk = onDocumentCreated(
  { document: 'companies/{companyId}/monthlyJobs/{jobId}/chunks/{chunkId}', region: 'asia-northeast1', timeoutSeconds: 540, memory: '512MiB' },
  async (event) => {
    await processMonthlyChunk(event.params.companyId, event.params.jobId, event.params.chunkId);
  },
);
