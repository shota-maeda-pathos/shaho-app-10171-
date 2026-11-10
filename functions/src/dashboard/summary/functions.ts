import { onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { z } from 'zod';
import { db } from '../../config';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { computeSummary, markSummaryStale, readSummary } from './service';
import { sendDeadlineReminders } from '../calendar/service';
import { deactivateResignedEmployees } from '../../employees/employee-resign/deactivate';

const input = z.object({ companyId: z.string().min(1), officeId: z.string().regex(/^[^/]+$/).optional() }).strict();
const readInput = input.extend({ ifStale: z.boolean().optional() }).strict();

/**
 * ホームのサマリーカード（保存した数字を読むだけ）。
 * ifStale のときは、数字が古い（数えたあとに承認などが動いた・前の日に数えた）ときだけ数え直してから返す。
 * 古いときしか数えないので、承認者・閲覧者が開いても数え直してよい
 */
export const dashboardSummary = onCall({ timeoutSeconds: 300, memory: '512MiB' }, async request => {
  const data = validate(readInput, request.data);
  const auth = await getAuthContext(request, data.companyId);
  requireRole(auth, 'admin', 'operator', 'approver', 'viewer');
  const summary = await readSummary(auth, data.officeId);
  if (!data.ifStale || !summary.stale) return summary;
  await computeSummary(data.companyId);
  return readSummary(auth, data.officeId);
});

/** 本人からの申請が動いたら、数字を古いしるしにする（承認・届出は索引のトリガーで付ける） */
export const dashboardSummaryStalePortal = onDocumentWritten({ document: 'companies/{companyId}/portalRequests/{requestId}', region: 'asia-northeast1' }, async event => {
  await markSummaryStale(event.params.companyId);
});

/** 「更新」ボタン：今の数字を数え直す */
export const dashboardSummaryRefresh = onCall({ timeoutSeconds: 300, memory: '512MiB' }, async request => {
  const data = validate(input, request.data);
  const auth = await getAuthContext(request, data.companyId);
  requireRole(auth, 'admin', 'operator');
  await computeSummary(data.companyId);
  return readSummary(auth, data.officeId);
});

/** 毎朝6時（東京）：退職日を過ぎた人を在籍から外し、全社の数字を数え直して保存し、期限の近い届出をお知らせにする */
export const dashboardSummaryDaily = onSchedule({ schedule: 'every day 06:00', timeZone: 'Asia/Tokyo', region: 'asia-northeast1', timeoutSeconds: 540, memory: '512MiB' }, async () => {
  const companies = await db.collection('companies').select().get();
  for (const c of companies.docs) {
    // 退職日を過ぎた人を在籍から外してから数える
    await deactivateResignedEmployees(c.id);
    await computeSummary(c.id);
    await sendDeadlineReminders(c.id);
  }
});
