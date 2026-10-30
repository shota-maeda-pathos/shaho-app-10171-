import { onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { FilingSubmissionActionSchema, FilingSubmissionGetSchema, MockSettingsSchema } from './schema';
import { actOnSubmission, getSubmission, mockSettings, processMockQueue } from './service';

/** 提出の状態（読むときに、予定の時刻を過ぎた模擬電子申請を進める） */
export const filingSubmissionGet = onCall(async (request) => {
  const input = validate(FilingSubmissionGetSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator', 'approver');
  return getSubmission(input, auth);
});

/** 提出の操作。役割の確認は操作ごとに service で行う */
export const filingSubmissionAction = onCall(async (request) => {
  const input = validate(FilingSubmissionActionSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return actOnSubmission(input, auth);
});

/** 模擬電子申請の待ち時間の設定（読むのは担当者も、変えるのは管理者だけ） */
export const filingMockSettings = onCall(async (request) => {
  const input = validate(MockSettingsSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator', 'approver');
  return mockSettings(input, auth);
});

/** 送信中の模擬電子申請を、予定の時刻を過ぎたら進める（1分ごと） */
export const filingMockAdvance = onSchedule({ schedule: 'every 1 minutes', region: 'asia-northeast1', timeoutSeconds: 120 }, async () => {
  await processMockQueue();
});
