import { getStorage } from 'firebase-admin/storage';
import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db } from '../config';
import { AuthContext, requireNotSuspended, requireOffice } from '../middleware/auth';
import { attachmentError, safeFileName, sniffContentType } from '../filings/attachments/rules';
import { invalidArg, notFound } from '../utils/errors';
import { self } from './service';

/**
 * 本人からの申請（カタログ11章）。本人が申請 → 担当者のやることに入る → 担当者が確かめて取り込む。
 * 住所・氏名の変更は担当者が確かめて台帳に反映する（12種の届出にないため届出は作らない）。
 * 扶養・産休育休は担当者が扶養・休業のウィザードに取り込んで、いつもの手順で届出まで進める
 */

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const REQUEST_TYPES = {
  address: '住所変更',
  name: '氏名変更',
  dependentAdd: '扶養の追加',
  dependentRemove: '扶養から外す',
  leave: '産休・育休',
} as const;

export const RequestCreateSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('address'), postalCode: z.string().regex(/^\d{3}-?\d{4}$/), prefecture: z.string().min(1).max(10), city: z.string().min(1).max(50), addressLine: z.string().min(1).max(100), building: z.string().max(100).optional(), movedOn: date }),
  z.object({ type: z.literal('name'), lastName: z.string().min(1).max(30), firstName: z.string().min(1).max(30), lastNameKana: z.string().min(1).max(60), firstNameKana: z.string().min(1).max(60), changedOn: date }),
  z.object({ type: z.literal('dependentAdd'), lastName: z.string().min(1).max(30), firstName: z.string().min(1).max(30), lastNameKana: z.string().max(60).optional(), firstNameKana: z.string().max(60).optional(), birthDate: date, relationship: z.enum(['spouse', 'child', 'parent', 'grandparent', 'sibling', 'grandchild', 'other']), coResident: z.boolean(), annualIncome: z.number().int().min(0).max(100_000_000), since: date }),
  z.object({ type: z.literal('dependentRemove'), dependentName: z.string().min(1).max(60), reason: z.string().min(1).max(200), since: date }),
  z.object({ type: z.literal('leave'), kind: z.enum(['maternity', 'childcare']), startDate: date, endDate: date, expectedBirthDate: date.optional(), note: z.string().max(400).optional() }),
]);

export const RequestCreateInput = z.object({ companyId: z.string().min(1), request: RequestCreateSchema, note: z.string().max(400).optional() });

export const RequestAttachSchema = z.object({
  companyId: z.string().min(1),
  requestId: z.string().regex(/^[^/]+$/),
  name: z.string().min(1).max(200),
  dataBase64: z.string().min(1).max(7_200_000),
}).strict();

export const RequestHandleSchema = z.object({
  companyId: z.string().min(1),
  requestId: z.string().regex(/^[^/]+$/),
  /** apply=台帳に反映（住所・氏名）、inProgress=ウィザードに取り込んだ、done=完了、reject=差し戻し */
  action: z.enum(['apply', 'inProgress', 'done', 'reject']),
  comment: z.string().max(400).optional(),
});

const col = (companyId: string) => db.collection(`companies/${companyId}/portalRequests`);

export interface PortalRequestItem {
  id: string;
  type: keyof typeof REQUEST_TYPES;
  typeLabel: string;
  employeeId: string;
  employeeName: string;
  officeId: string;
  status: 'submitted' | 'inProgress' | 'done' | 'rejected';
  detail: Record<string, unknown>;
  note: string | null;
  attachments: { name: string; size: number }[];
  comment: string | null;
  createdAt: string | null;
}

function toItem(d: FirebaseFirestore.DocumentSnapshot): PortalRequestItem {
  const x = d.data()!;
  return {
    id: d.id, type: x.type, typeLabel: REQUEST_TYPES[x.type as keyof typeof REQUEST_TYPES] ?? x.type,
    employeeId: x.employeeId, employeeName: x.employeeName, officeId: x.officeId, status: x.status,
    detail: x.detail ?? {}, note: x.note ?? null,
    attachments: (x.attachments ?? []).map((a: { name: string; size: number }) => ({ name: a.name, size: a.size })),
    comment: x.comment ?? null, createdAt: x.createdAt?.toDate?.().toISOString() ?? null,
  };
}

/** 本人が申請する。退職日の翌日からは閲覧だけで申請できない */
export async function createRequest(input: z.infer<typeof RequestCreateInput>, auth: AuthContext) {
  requireNotSuspended(auth);
  const employee = await self(auth);
  if (!employee) throw new HttpsError('failed-precondition', '従業員との紐付けがありません。管理者に確認してください');
  const { type, ...detail } = input.request;
  const now = Timestamp.now();
  const ref = col(auth.companyId).doc();
  const batch = db.batch();
  batch.set(ref, {
    type, detail, note: input.note ?? null, status: 'submitted', attachments: [],
    employeeId: auth.employeeId, employeeName: `${employee.data.lastName} ${employee.data.firstName}`, officeId: employee.data.officeId,
    userId: auth.uid, comment: null, createdAt: now, updatedAt: now,
  });
  batch.set(db.collection(`companies/${auth.companyId}/auditLogs`).doc(), {
    entity: 'portalRequest', entityId: ref.id, action: 'create', changes: { type }, performedBy: auth.uid, performedAt: now, version: 1,
  });
  await batch.commit();
  return { id: ref.id };
}

/** 本人が申請に書類を添える（扶養の追加などで使う）。担当者が受け付けるまで */
export async function attachToRequest(input: z.infer<typeof RequestAttachSchema>, auth: AuthContext) {
  requireNotSuspended(auth);
  const ref = col(auth.companyId).doc(input.requestId);
  const snap = await ref.get();
  if (!snap.exists || snap.data()!.userId !== auth.uid) throw notFound('申請');
  if (snap.data()!.status !== 'submitted') throw invalidArg('担当者が受け付けた申請には書類を足せません。担当者に渡してください');
  const bytes = new Uint8Array(Buffer.from(input.dataBase64, 'base64'));
  const existing = (snap.data()!.attachments ?? []).length;
  const error = attachmentError({ name: input.name, bytes, existing });
  if (error) throw invalidArg(error);
  const contentType = sniffContentType(bytes)!;
  const name = safeFileName(input.name);
  const storagePath = `companies/${auth.companyId}/portalRequests/${input.requestId}/${Date.now()}_${name}`;
  await getStorage().bucket().file(storagePath).save(Buffer.from(bytes), { contentType, resumable: false });
  const attachments = [...(snap.data()!.attachments ?? []), { name, size: bytes.length, contentType, storagePath, uploadedAt: Timestamp.now() }];
  await ref.update({ attachments, updatedAt: Timestamp.now() });
  return { success: true };
}

export async function listMyRequests(auth: AuthContext): Promise<{ items: PortalRequestItem[] }> {
  const snap = await col(auth.companyId).where('userId', '==', auth.uid).get();
  return { items: snap.docs.map(toItem).sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')) };
}

/** 担当者が見る申請の一覧（担当事業所のもの。終わったものは除く） */
export async function listRequestsForStaff(auth: AuthContext, includeClosed: boolean): Promise<{ items: PortalRequestItem[] }> {
  const snap = await col(auth.companyId).get();
  const items = snap.docs.map(toItem)
    .filter(i => auth.roles.includes('admin') || auth.officeIds.includes(i.officeId))
    .filter(i => includeClosed || i.status === 'submitted' || i.status === 'inProgress')
    .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  return { items };
}

/** 添付した書類を担当者が取り出す */
export async function getRequestAttachment(auth: AuthContext, requestId: string, index: number) {
  const snap = await col(auth.companyId).doc(requestId).get();
  if (!snap.exists) throw notFound('申請');
  requireOffice(auth, snap.data()!.officeId);
  const a = (snap.data()!.attachments ?? [])[index];
  if (!a) throw notFound('添付書類');
  const [bytes] = await getStorage().bucket().file(a.storagePath).download();
  return { name: a.name, contentType: a.contentType, dataBase64: bytes.toString('base64') };
}

/** 担当者の対応。住所・氏名は「反映」で台帳を書き換える（前後の値を監査ログに残す） */
export async function handleRequest(input: z.infer<typeof RequestHandleSchema>, auth: AuthContext) {
  const ref = col(auth.companyId).doc(input.requestId);
  const now = Timestamp.now();
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw notFound('申請');
    const r = snap.data()!;
    requireOffice(auth, r.officeId);
    if (r.status === 'done' || r.status === 'rejected') throw invalidArg('この申請はもう終わっています');
    const empRef = db.doc(`companies/${auth.companyId}/employees/${r.employeeId}`);
    const emp = await tx.get(empRef);
    if (!emp.exists) throw notFound('従業員');
    let status: string = input.action === 'reject' ? 'rejected' : input.action === 'inProgress' ? 'inProgress' : 'done';
    const audit: Record<string, unknown> = { action: input.action };
    if (input.action === 'apply') {
      if (r.type !== 'address' && r.type !== 'name') throw invalidArg('台帳への反映は住所・氏名の変更だけです。扶養・休業はウィザードに取り込んでください');
      const d = r.detail;
      const fields = r.type === 'address'
        ? { postalCode: d.postalCode, prefecture: d.prefecture, city: d.city, addressLine: d.addressLine, building: d.building ?? null }
        : { lastName: d.lastName, firstName: d.firstName, lastNameKana: d.lastNameKana, firstNameKana: d.firstNameKana, ...(r.type === 'name' ? { formerLastName: emp.data()!.lastName } : {}) };
      const changes = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { from: emp.data()![k] ?? null, to: v ?? null }]));
      tx.update(empRef, { ...fields, updatedAt: now, version: (emp.data()!.version ?? 1) + 1 });
      tx.set(db.collection(`companies/${auth.companyId}/auditLogs`).doc(), {
        entity: 'employee', entityId: r.employeeId, action: 'update', changes: { ...changes, source: { from: null, to: `portalRequest:${ref.id}` } },
        performedBy: auth.uid, performedAt: now, version: (emp.data()!.version ?? 1) + 1,
      });
      status = 'done';
    }
    tx.update(ref, { status, comment: input.comment ?? r.comment ?? null, handledBy: auth.uid, handledAt: now, updatedAt: now });
    tx.set(db.collection(`companies/${auth.companyId}/auditLogs`).doc(), {
      entity: 'portalRequest', entityId: ref.id, action: input.action, changes: audit, performedBy: auth.uid, performedAt: now, version: 0,
    });
    // 本人へのお知らせ
    tx.set(db.collection(`companies/${auth.companyId}/notifications`).doc(), {
      title: `${REQUEST_TYPES[r.type as keyof typeof REQUEST_TYPES]}の申請：${status === 'done' ? '手続きが終わりました' : status === 'rejected' ? '差し戻されました' : '担当者が手続きを始めました'}`,
      body: input.comment || '詳しくは本人ポータルの「申請」を見てください。', category: status === 'rejected' ? 'action' : 'info',
      targetType: 'employee', targetId: r.employeeId, createdBy: auth.uid, createdAt: now, updatedAt: now,
    });
  });
  return { success: true };
}
