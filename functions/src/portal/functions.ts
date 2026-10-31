import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { portalOverviewSchema, portalPayslipGetSchema } from './schema';
import { getPortalOverview, getPortalPayslip } from './service';
import { z } from 'zod';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../config';
import { requireRole } from '../middleware/auth';
import { getPortalDetails } from './details';
import { PORTAL_ITEMS, hiddenItems } from './visibility';
import {
  RequestAttachSchema, RequestCreateInput, RequestHandleSchema,
  attachToRequest, createRequest, getRequestAttachment, handleRequest, listMyRequests, listRequestsForStaff,
} from './requests';
export const portalOverview = onCall(async request => {
 const input = validate(portalOverviewSchema, request.data);
 return getPortalOverview(input, await getAuthContext(request, input.companyId));
});
export const portalPayslipGet = onCall(async request => {
 const input = validate(portalPayslipGetSchema, request.data);
 return getPortalPayslip(input, await getAuthContext(request, input.companyId));
});

// 本人ポータルの詳しい情報・公開範囲・本人からの申請（段階9。docs/stage9-plan.md）
const companyOnly = z.object({ companyId: z.string().min(1) });

export const portalDetails = onCall(async request => {
  const input = validate(companyOnly, request.data);
  return getPortalDetails(await getAuthContext(request, input.companyId));
});

/** 公開範囲の設定（管理者）。項目の一覧と、非公開にしている項目 */
export const portalSettingsGet = onCall(async request => {
  const input = validate(companyOnly, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin');
  return { items: Object.entries(PORTAL_ITEMS).map(([key, label]) => ({ key, label })), hidden: [...await hiddenItems(input.companyId)] };
});

export const portalSettingsUpdate = onCall(async request => {
  const input = validate(companyOnly.extend({ hidden: z.array(z.enum(Object.keys(PORTAL_ITEMS) as [string, ...string[]])).max(20) }), request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin');
  const before = [...await hiddenItems(input.companyId)];
  const now = Timestamp.now();
  const batch = db.batch();
  batch.set(db.doc(`companies/${input.companyId}/settings/portal`), { hidden: input.hidden, updatedAt: now, updatedBy: auth.uid }, { merge: true });
  batch.set(db.collection(`companies/${input.companyId}/auditLogs`).doc(), {
    entity: 'portalSettings', entityId: 'portal', action: 'update', changes: { hidden: { from: before, to: input.hidden } },
    performedBy: auth.uid, performedAt: now, version: 0,
  });
  await batch.commit();
  return { success: true };
});

export const portalRequestCreate = onCall(async request => {
  const input = validate(RequestCreateInput, request.data);
  return createRequest(input, await getAuthContext(request, input.companyId));
});

export const portalRequestAttach = onCall(async request => {
  const input = validate(RequestAttachSchema, request.data);
  return attachToRequest(input, await getAuthContext(request, input.companyId));
});

export const portalRequestMine = onCall(async request => {
  const input = validate(companyOnly, request.data);
  return listMyRequests(await getAuthContext(request, input.companyId));
});

/** 担当者の一覧・添付の取り出し・対応 */
export const portalRequestList = onCall(async request => {
  const input = validate(companyOnly.extend({ includeClosed: z.boolean().optional() }), request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return listRequestsForStaff(auth, input.includeClosed ?? false);
});

export const portalRequestAttachmentGet = onCall(async request => {
  const input = validate(companyOnly.extend({ requestId: z.string().regex(/^[^/]+$/), index: z.number().int().min(0).max(19) }), request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return getRequestAttachment(auth, input.requestId, input.index);
});

export const portalRequestHandle = onCall(async request => {
  const input = validate(RequestHandleSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return handleRequest(input, auth);
});
