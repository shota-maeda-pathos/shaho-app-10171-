import { onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { z } from 'zod';
import { db } from '../../config';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { computeSummary, readSummary } from './service';
import { sendDeadlineReminders } from '../calendar/service';

const input = z.object({ companyId: z.string().min(1), officeId: z.string().regex(/^[^/]+$/).optional() }).strict();

/** ホームのサマリーカード（保存した数字を読むだけ） */
export const dashboardSummary = onCall(async request => {
  const data = validate(input, request.data);
  const auth = await getAuthContext(request, data.companyId);
  requireRole(auth, 'admin', 'operator', 'approver', 'viewer');
  return readSummary(auth, data.officeId);
});

/** 「更新」ボタン：今の数字を数え直す */
export const dashboardSummaryRefresh = onCall({ timeoutSeconds: 300, memory: '512MiB' }, async request => {
  const data = validate(input, request.data);
  const auth = await getAuthContext(request, data.companyId);
  requireRole(auth, 'admin', 'operator');
  await computeSummary(data.companyId);
  return readSummary(auth, data.officeId);
});

/** 毎朝6時（東京）：全社の数字を数え直して保存し、期限の近い届出をお知らせにする */
export const dashboardSummaryDaily = onSchedule({ schedule: 'every day 06:00', timeZone: 'Asia/Tokyo', region: 'asia-northeast1', timeoutSeconds: 540, memory: '512MiB' }, async () => {
  const companies = await db.collection('companies').select().get();
  for (const c of companies.docs) {
    await computeSummary(c.id);
    await sendDeadlineReminders(c.id);
  }
});
