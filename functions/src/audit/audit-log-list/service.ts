import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext } from '../../middleware/auth';
import { chainHash } from '../seal';
import { AuditLogFilter, AuditLogListInput } from './schema';

export interface AuditLogItem {
  id: string;
  seq: number | null;
  performedAt: string;
  performedBy: string;
  performedByName: string;
  entity: string;
  entityId: string;
  action: string;
  changes: Record<string, unknown>;
  ip: string;
}

export interface AuditLogListResponse {
  items: AuditLogItem[];
  hasMore: boolean;
  lastDocId?: string;
}

/** 東京の日付の始まり（YYYY-MM-DD の 0:00 JST） */
function tokyoStart(date: string): Timestamp {
  return Timestamp.fromDate(new Date(`${date}T00:00:00+09:00`));
}

function baseQuery(companyId: string, f: AuditLogFilter): FirebaseFirestore.Query {
  // 複合索引に頼らないよう、並べるのは日時だけにし、操作者・種類は読んだあとで絞る
  let q: FirebaseFirestore.Query = db.collection(`companies/${companyId}/auditLogs`).orderBy('performedAt', 'desc');
  if (f.from) q = q.where('performedAt', '>=', tokyoStart(f.from));
  if (f.to) q = q.where('performedAt', '<', Timestamp.fromMillis(tokyoStart(f.to).toMillis() + 24 * 60 * 60 * 1000));
  return q;
}

function matches(d: FirebaseFirestore.DocumentData, f: AuditLogFilter): boolean {
  if (f.actorUid && d.performedBy !== f.actorUid) return false;
  if (f.kind) {
    const [entity, action] = f.kind.split('.');
    if (d.entity !== entity) return false;
    if (action && d.action !== action) return false;
  }
  return true;
}

async function namesOf(companyId: string): Promise<Map<string, string>> {
  const snap = await db.collection(`companies/${companyId}/users`).get();
  return new Map(snap.docs.map((u) => [u.id, u.data().displayName ?? '']));
}

function toItem(d: FirebaseFirestore.QueryDocumentSnapshot, names: Map<string, string>): AuditLogItem {
  const x = d.data();
  return {
    id: d.id,
    seq: typeof x.seq === 'number' ? x.seq : null,
    performedAt: (x.performedAt as Timestamp | undefined)?.toDate().toISOString() ?? '',
    performedBy: x.performedBy ?? '',
    performedByName: x.performedByName ?? names.get(x.performedBy) ?? '',
    entity: x.entity ?? '',
    entityId: x.entityId ?? '',
    action: x.action ?? '',
    changes: x.changes ?? {},
    ip: x.ip ?? '',
  };
}

/** 読む件数の上限（絞り込みで当たりが少ないときに読み続けないため） */
const SCAN_PAGE = 300;

export async function listAuditLogs(input: AuditLogListInput, auth: AuthContext): Promise<AuditLogListResponse> {
  const limit = input.limit ?? 50;
  let q = baseQuery(auth.companyId, input);
  if (input.lastDocId) {
    const last = await db.doc(`companies/${auth.companyId}/auditLogs/${input.lastDocId}`).get();
    if (last.exists) q = q.startAfter(last);
  }
  const [snap, names] = await Promise.all([q.limit(SCAN_PAGE).get(), namesOf(auth.companyId)]);
  const hits: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  let lastScanned: string | undefined;
  for (const d of snap.docs) {
    lastScanned = d.id;
    if (!matches(d.data(), input)) continue;
    hits.push(d);
    if (hits.length === limit) break;
  }
  const hasMore = hits.length === limit || snap.docs.length === SCAN_PAGE;
  return { items: hits.map((d) => toItem(d, names)), hasMore, lastDocId: hasMore ? lastScanned : undefined };
}

const CSV_MAX = 5000;

function csvCell(v: unknown): string {
  const s = typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 絞り込んだ監査ログを CSV にする（出力したことも監査ログに残す） */
export async function exportAuditLogs(f: AuditLogFilter, auth: AuthContext): Promise<{ csv: string; count: number; truncated: boolean }> {
  const [snap, names] = await Promise.all([baseQuery(auth.companyId, f).limit(CSV_MAX * 2).get(), namesOf(auth.companyId)]);
  const rows = snap.docs.filter((d) => matches(d.data(), f)).slice(0, CSV_MAX).map((d) => toItem(d, names));
  const header = ['通し番号', '日時', '操作者ID', '操作者', '対象の種類', '対象ID', '操作', '内容', 'IP'];
  const lines = rows.map((r) => [
    r.seq ?? '', new Date(r.performedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }), r.performedBy, r.performedByName,
    r.entity, r.entityId, r.action, r.changes, r.ip,
  ].map(csvCell).join(','));
  await db.collection(`companies/${auth.companyId}/auditLogs`).add({
    entity: 'auditLog', entityId: 'export', action: 'csvExport',
    changes: { filter: { from: f.from ?? null, to: f.to ?? null, actorUid: f.actorUid ?? null, kind: f.kind ?? null }, count: rows.length },
    performedBy: auth.uid, performedAt: Timestamp.now(), version: 0,
  });
  return { csv: '﻿' + [header.join(','), ...lines].join('\r\n'), count: rows.length, truncated: snap.docs.length >= CSV_MAX * 2 };
}

/** 通し番号の順に指紋をたどり、書き換え・抜けがないか確かめる */
export async function verifyAuditChain(auth: AuthContext): Promise<{ checked: number; ok: boolean; problems: string[]; unsealed: number }> {
  const snap = await db.collection(`companies/${auth.companyId}/auditLogs`).orderBy('seq', 'asc').get();
  const problems: string[] = [];
  let prevHash = '';
  let expected = 1;
  for (const d of snap.docs) {
    const x = d.data();
    if (x.seq !== expected) problems.push(`通し番号 ${expected} の記録がありません（次は ${x.seq}）`);
    if (x.prevHash !== prevHash) problems.push(`通し番号 ${x.seq}：前の記録とのつながりが合いません`);
    if (chainHash(x.prevHash ?? '', x.seq, x) !== x.hash) problems.push(`通し番号 ${x.seq}：中身が書き換えられています`);
    prevHash = x.hash;
    expected = x.seq + 1;
    if (problems.length >= 20) break;
  }
  const total = (await db.collection(`companies/${auth.companyId}/auditLogs`).count().get()).data().count;
  return { checked: snap.size, ok: problems.length === 0, problems, unsealed: total - snap.size };
}
