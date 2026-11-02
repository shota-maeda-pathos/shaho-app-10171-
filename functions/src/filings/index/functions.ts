import { onCall } from 'firebase-functions/v2/https';
import { auditAccess } from '../../utils/audit';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { FilingIndexRebuildSchema, FilingSearchSchema } from './schema';
import { rebuildFilingIndex, searchFilings, syncFilingIndex } from './service';
import { markSummaryStale } from '../../dashboard/summary/service';

// 届出の索引。Firestore のトリガーはデータベースと同じ地域に置く
const trigger = (document: string) => onDocumentWritten({ document, region: 'asia-northeast1' }, async (event) => {
  await syncFilingIndex(event.document, event.data?.after.exists ? event.data.after.data() : undefined);
  await markSummaryStale(event.params.companyId);
});

export const filingIndexEmployee = trigger('companies/{companyId}/employees/{parentId}/filings/{filingId}');
export const filingIndexSantei = trigger('companies/{companyId}/santeiRuns/{parentId}/filings/{filingId}');
export const filingIndexBonus = trigger('companies/{companyId}/bonusRuns/{parentId}/filings/{filingId}');

/** 届出の横断検索。承認者も届出の状況を見られるようにする */
export const filingSearch = onCall({ timeoutSeconds: 60, memory: '512MiB' }, async (request) => {
  const input = validate(FilingSearchSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator', 'approver');
  const data = await searchFilings(input, auth);
  if (input.keyword) await auditAccess(auth, 'filing', 'search', 'search', { keyword: input.keyword });
  return data;
});

/** 既存の届出を索引に入れ直す（移行用。管理者だけ） */
export const filingIndexRebuild = onCall({ timeoutSeconds: 540, memory: '1GiB', maxInstances: 1 }, async (request) => {
  const input = validate(FilingIndexRebuildSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin');
  return rebuildFilingIndex(auth);
});
