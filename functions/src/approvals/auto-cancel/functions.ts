import { onCall } from 'firebase-functions/v2/https';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { z } from 'zod';
import { db } from '../../config';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { onCompanyChanged, onEmployeeChanged, onSalaryChanged } from './service';

// 届出に載る情報が変わったら、承認済み（未送信）の届出の承認を自動で取り消す。Firestore のトリガーはデータベースと同じ地域に置く

export const companyChangedForFilings = onDocumentWritten({ document: 'companies/{companyId}', region: 'asia-northeast1' }, async (event) => {
  await onCompanyChanged(event.params.companyId, event.data?.before.data(), event.data?.after.data());
});

export const employeeChangedForFilings = onDocumentWritten({ document: 'companies/{companyId}/employees/{employeeId}', region: 'asia-northeast1' }, async (event) => {
  await onEmployeeChanged(event.params.companyId, event.params.employeeId, event.data?.before.data(), event.data?.after.data());
});

export const salaryChangedForFilings = onDocumentWritten({ document: 'companies/{companyId}/employees/{employeeId}/salaries/{month}', region: 'asia-northeast1' }, async (event) => {
  await onSalaryChanged(event.params.companyId, event.params.employeeId, event.params.month, event.data?.before.data(), event.data?.after.data());
});

/** 会社情報の変更の履歴（版）。新しい順 */
export const companyHistoryList = onCall(async (request) => {
  const input = validate(z.object({ companyId: z.string().min(1) }).strict(), request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator', 'approver');
  const snap = await db.collection(`companies/${auth.companyId}/companyVersions`).orderBy('changedAt', 'desc').limit(50).get();
  return {
    items: snap.docs.map(d => {
      const x = d.data();
      return { id: d.id, version: x.version ?? null, changedFields: x.changedFields ?? [], before: x.before ?? {}, after: x.after ?? {}, changedAt: x.changedAt?.toDate?.().toISOString() ?? null };
    }),
  };
});
