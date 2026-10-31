import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { getAuthContext, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { applyRates, gradeTableView, previewRates, rateHistory } from './service';

const companyId = z.string().min(1);
const csv = z.string().min(1).max(200_000);

/** 料率の CSV を確かめる（今の料率との差）。管理者だけ */
export const rateImportPreview = onCall(async request => {
  const input = validate(z.object({ companyId, csv }), request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin');
  return previewRates(auth, input.csv);
});

/** 料率を取り込んで切り替える（前の料率は履歴に残す）。管理者だけ */
export const rateImportApply = onCall(async request => {
  const input = validate(z.object({ companyId, csv }), request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin');
  return applyRates(auth, input.csv);
});

export const rateHistoryList = onCall(async request => {
  const input = validate(z.object({ companyId }), request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator', 'approver', 'viewer');
  return rateHistory(auth);
});

/** 保険料額表の閲覧 */
export const gradeTableGet = onCall(async request => {
  const input = validate(z.object({ companyId, prefectureCode: z.string().regex(/^\d{2}$/), yearMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), insurerId: z.string().max(40).optional() }), request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator', 'approver', 'viewer');
  return gradeTableView(auth, input.prefectureCode, input.yearMonth, input.insurerId);
});
