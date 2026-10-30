import { randomUUID } from 'crypto';
import { getStorage } from 'firebase-admin/storage';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext } from '../../middleware/auth';
import { invalidArg, notFound } from '../../utils/errors';
import { isInTransit, stateOf } from '../submission/rules';
import { loadAndCheck } from '../submission/service';
import { attachmentChecklist, attachmentError, ChecklistItem, missingRequired, safeFileName, sniffContentType } from './rules';
import { AttachmentDeleteInput, AttachmentGetInput, AttachmentListInput, AttachmentUploadInput } from './schema';

// 届出の添付書類。ファイルは関数だけが Cloud Storage（既定のバケット）に書き、画面から Storage を直接触らない。
// 一覧（名前・種類・大きさ・どの必要書類か）は届出の下の attachments に持つ。提出したあとは消せない。

const sourceOf = (path: string) => (path.includes('/employees/') ? 'employee' : path.includes('/santeiRuns/') ? 'santei' : 'bonus') as 'employee' | 'santei' | 'bonus';

/** 提出を始めた・終えた届出か（添付を消せない） */
function locked(path: string, data: FirebaseFirestore.DocumentData): boolean {
  const { mock, paper } = stateOf(sourceOf(path), data);
  return isInTransit(mock) || mock?.status === 'completed' || paper?.status === 'submitted' || paper?.status === 'accepted';
}

async function checklistOf(path: string, data: FirebaseFirestore.DocumentData): Promise<ChecklistItem[]> {
  const original = data.originalFilingId ? (await db.doc(path).parent.doc(data.originalFilingId).get()).data() : undefined;
  return attachmentChecklist(String(data.filingType ?? ''), (data.formData ?? data.header ?? {}) as Record<string, unknown>, original);
}

export interface AttachmentItem {
  id: string;
  name: string;
  contentType: string;
  size: number;
  checklistKey: string | null;
  uploadedAt: string | null;
  uploadedByName: string;
}

async function listOf(path: string): Promise<AttachmentItem[]> {
  const snap = await db.collection(`${path}/attachments`).where('deletedAt', '==', null).get();
  const companyId = path.split('/')[1];
  const names = new Map<string, string>();
  for (const uid of new Set(snap.docs.map(d => d.data().uploadedBy as string))) {
    names.set(uid, ((await db.doc(`companies/${companyId}/users/${uid}`).get()).data()?.displayName as string | undefined) ?? '');
  }
  return snap.docs.map(d => {
    const a = d.data();
    return {
      id: d.id, name: a.name, contentType: a.contentType, size: a.size, checklistKey: a.checklistKey ?? null,
      uploadedAt: a.uploadedAt?.toDate?.().toISOString() ?? null, uploadedByName: names.get(a.uploadedBy) ?? '',
    };
  }).sort((a, b) => (a.uploadedAt ?? '').localeCompare(b.uploadedAt ?? ''));
}

/** 提出の部品が送信前に出す警告：原則必要な書類で、まだ添付のないもの */
export async function attachmentWarnings(path: string, data: FirebaseFirestore.DocumentData): Promise<string[]> {
  const [checklist, items] = await Promise.all([checklistOf(path, data), listOf(path)]);
  return missingRequired(checklist, items.map(i => i.checklistKey)).map(i => `添付書類がありません：${i.label}`);
}

export async function listAttachments(input: AttachmentListInput, auth: AuthContext) {
  const { path, data } = await loadAndCheck(auth.companyId, input, auth);
  const [checklist, items] = await Promise.all([checklistOf(path, data), listOf(path)]);
  return {
    checklist, items, locked: locked(path, data),
    missing: missingRequired(checklist, items.map(i => i.checklistKey)).map(i => i.key),
  };
}

export async function uploadAttachment(input: AttachmentUploadInput, auth: AuthContext) {
  if (!auth.roles.some(r => r === 'admin' || r === 'operator')) throw invalidArg('添付できるのは管理者・担当者です');
  const { path, data } = await loadAndCheck(auth.companyId, input, auth);
  if (locked(path, data)) throw invalidArg('提出を始めた届出には添付できません');
  const checklist = await checklistOf(path, data);
  if (input.checklistKey && !checklist.some(i => i.key === input.checklistKey)) throw invalidArg('必要書類の指定が正しくありません');
  const bytes = new Uint8Array(Buffer.from(input.dataBase64, 'base64'));
  const existing = (await db.collection(`${path}/attachments`).where('deletedAt', '==', null).count().get()).data().count;
  const error = attachmentError({ name: input.name, bytes, existing });
  if (error) throw invalidArg(error);
  const contentType = sniffContentType(bytes)!;
  const id = randomUUID();
  const name = safeFileName(input.name);
  const storagePath = `${path}/attachments/${id}/${name}`;
  await getStorage().bucket().file(storagePath).save(Buffer.from(bytes), {
    contentType, resumable: false, metadata: { metadata: { uploadedBy: auth.uid } },
  });
  const now = Timestamp.now();
  await db.doc(`${path}/attachments/${id}`).set({
    name, contentType, size: bytes.length, checklistKey: input.checklistKey ?? null, storagePath,
    uploadedBy: auth.uid, uploadedAt: now, deletedAt: null,
  });
  await db.collection(`companies/${auth.companyId}/auditLogs`).doc().set({
    entity: 'filingAttachment', entityId: id, action: 'create', changes: { name: { from: null, to: name } },
    note: path, performedBy: auth.uid, performedAt: now, version: 1,
  });
  return { success: true, id };
}

/** 添付の中身（保存・表示用）。5MBまでなので base64 でそのまま返す */
export async function getAttachment(input: AttachmentGetInput, auth: AuthContext) {
  const { path } = await loadAndCheck(auth.companyId, input, auth);
  const snap = await db.doc(`${path}/attachments/${input.attachmentId}`).get();
  if (!snap.exists || snap.data()!.deletedAt) throw notFound('添付ファイル');
  const a = snap.data()!;
  const [bytes] = await getStorage().bucket().file(a.storagePath).download();
  return { name: a.name, contentType: a.contentType, dataBase64: bytes.toString('base64') };
}

/** 添付を消す（提出前だけ。ファイルも消し、一覧には消した印を残す） */
export async function deleteAttachment(input: AttachmentDeleteInput, auth: AuthContext) {
  if (!auth.roles.some(r => r === 'admin' || r === 'operator')) throw invalidArg('添付を消せるのは管理者・担当者です');
  const { path, data } = await loadAndCheck(auth.companyId, input, auth);
  if (locked(path, data)) throw invalidArg('提出を始めた届出の添付は消せません');
  const ref = db.doc(`${path}/attachments/${input.attachmentId}`);
  const snap = await ref.get();
  if (!snap.exists || snap.data()!.deletedAt) throw notFound('添付ファイル');
  await getStorage().bucket().file(snap.data()!.storagePath).delete({ ignoreNotFound: true });
  const now = Timestamp.now();
  await ref.update({ deletedAt: now, deletedBy: auth.uid });
  await db.collection(`companies/${auth.companyId}/auditLogs`).doc().set({
    entity: 'filingAttachment', entityId: input.attachmentId, action: 'delete', changes: { name: { from: snap.data()!.name, to: null } },
    note: path, performedBy: auth.uid, performedAt: now, version: 1,
  });
  return { success: true };
}
