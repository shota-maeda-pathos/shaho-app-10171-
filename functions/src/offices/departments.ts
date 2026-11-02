import { onCall } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { db } from '../config';
import { AuthContext, getAuthContext, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { DepartmentDoc } from '../types/firestore';
import { invalidArg, notFound } from '../utils/errors';

/** 従業員の所属部署を確かめる（あること・同じ事業所の部署であること・使っていること）。null は「部署なし」 */
export async function assertDepartment(companyId: string, departmentId: string | null | undefined, officeId: string): Promise<void> {
  if (!departmentId) return;
  const snap = await db.doc(`companies/${companyId}/departments/${departmentId}`).get();
  if (!snap.exists) throw invalidArg('選んだ部署が見つかりません。画面を読み込み直してください');
  const d = snap.data() as DepartmentDoc;
  if (d.officeId !== officeId) throw invalidArg(`「${d.name}」はほかの事業所の部署です`);
  if (!d.isActive) throw invalidArg(`「${d.name}」は使わない部署にしてあります`);
}

const id = z.string().min(1).regex(/^[^/]+$/);
const SaveSchema = z.object({
  companyId: id, departmentId: id.optional(), officeId: id, name: z.string().trim().min(1).max(50),
  sortOrder: z.number().int().min(0).max(9999).default(0), isActive: z.boolean().default(true),
});

/**
 * 部署を作る・直す（カタログ1章 部署の管理）。同じ事業所で同じ名前は作らない。
 * 使わなくなった部署は消さずに「使わない」にする（過去の集計で名前を出すため）
 */
export async function saveDepartment(input: z.infer<typeof SaveSchema>, auth: AuthContext) {
  const col = db.collection(`companies/${auth.companyId}/departments`);
  const [office, all] = await Promise.all([db.doc(`companies/${auth.companyId}/offices/${input.officeId}`).get(), col.get()]);
  if (!office.exists) throw notFound('事業所');
  if (all.docs.some(d => d.id !== input.departmentId && d.data().officeId === input.officeId && d.data().name === input.name)) {
    throw invalidArg(`この事業所には「${input.name}」がもうあります`);
  }
  const ref = input.departmentId ? col.doc(input.departmentId) : col.doc();
  const now = Timestamp.now();
  await db.runTransaction(async tx => {
    const cur = input.departmentId ? await tx.get(ref) : null;
    if (input.departmentId && !cur?.exists) throw notFound('部署');
    const before = cur?.data() as DepartmentDoc | undefined;
    if (before && before.officeId !== input.officeId) throw invalidArg('部署の事業所は変えられません。新しい部署を作ってください');
    const data = { name: input.name, officeId: input.officeId, sortOrder: input.sortOrder, isActive: input.isActive, parentId: before?.parentId ?? null, updatedAt: now };
    if (before) tx.update(ref, data);
    else tx.set(ref, { ...data, createdAt: now });
    tx.set(db.collection(`companies/${auth.companyId}/auditLogs`).doc(), {
      entity: 'department', entityId: ref.id, action: before ? 'update' : 'create',
      changes: { name: { from: before?.name ?? null, to: input.name }, isActive: { from: before?.isActive ?? null, to: input.isActive } },
      performedBy: auth.uid, performedAt: now, version: 0,
    });
  });
  return { success: true, id: ref.id };
}

/** 部署の作成・更新。管理者だけ */
export const departmentSave = onCall(async request => {
  const input = validate(SaveSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin');
  return saveDepartment(input, auth);
});
