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
  /** IP を記録した操作ではなく、その人のセッションの IP で補ったもの（同じ人が別の端末も使っていると違うことがある） */
  ipEstimated: boolean;
  /** 対象の従業員（社員番号と氏名）。従業員にひもづかない記録は空 */
  targetEmployee: string;
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

const EMPLOYEE_ENTITIES = new Set(['employee', 'employeeMyNumber']);

/** 記録から読み取れる従業員の ID（記録にない手続きは、手続きの ID を返して後で引く） */
function employeeRef(x: FirebaseFirestore.DocumentData): { employeeId?: string; procedureId?: string } {
  if (typeof x.employeeId === 'string' && x.employeeId) return { employeeId: x.employeeId };
  const entityId = typeof x.entityId === 'string' ? x.entityId : '';
  if (EMPLOYEE_ENTITIES.has(x.entity) && entityId) return { employeeId: entityId };
  // 給与・保険料などは「従業員ID/年月」の形
  if (entityId.includes('/')) return { employeeId: entityId.split('/')[0] };
  if (x.entity === 'procedure' && entityId) return { procedureId: entityId };
  return {};
}

/** 1ページ分の記録の対象の従業員を「社員番号 氏名」にする（そのページに出てくる人だけ読む） */
async function targetEmployees(companyId: string, docs: FirebaseFirestore.QueryDocumentSnapshot[]): Promise<Map<string, string>> {
  const refs = new Map(docs.map((d) => [d.id, employeeRef(d.data())]));
  const procIds = [...new Set([...refs.values()].map((r) => r.procedureId).filter((v): v is string => !!v))];
  const procEmployee = new Map<string, string>();
  if (procIds.length) {
    const procs = await db.getAll(...procIds.map((id) => db.doc(`companies/${companyId}/procedures/${id}`)));
    for (const p of procs) if (p.exists && typeof p.data()?.employeeId === 'string') procEmployee.set(p.id, p.data()!.employeeId);
  }
  const employeeIdOf = (r: { employeeId?: string; procedureId?: string }) => r.employeeId ?? (r.procedureId ? procEmployee.get(r.procedureId) : undefined);
  const empIds = [...new Set([...refs.values()].map(employeeIdOf).filter((v): v is string => !!v && !v.includes('/')))];
  const label = new Map<string, string>();
  if (empIds.length) {
    const emps = await db.getAll(...empIds.map((id) => db.doc(`companies/${companyId}/employees/${id}`)));
    for (const e of emps) {
      if (!e.exists) continue;
      const v = e.data()!;
      label.set(e.id, [v.employeeNumber, `${v.lastName ?? ''} ${v.firstName ?? ''}`.trim()].filter(Boolean).join(' '));
    }
  }
  const out = new Map<string, string>();
  for (const [docId, r] of refs) {
    const id = employeeIdOf(r);
    if (id && label.has(id)) out.set(docId, label.get(id)!);
  }
  return out;
}

function toItem(d: FirebaseFirestore.QueryDocumentSnapshot, names: Map<string, string>, targets: Map<string, string> = new Map()): AuditLogItem {
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
    ipEstimated: x.ipSource === 'session',
    targetEmployee: targets.get(d.id) ?? '',
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
  const targets = await targetEmployees(auth.companyId, hits);
  return { items: hits.map((d) => toItem(d, names, targets)), hasMore, lastDocId: hasMore ? lastScanned : undefined };
}

const CSV_MAX = 5000;

function csvCell(v: unknown): string {
  const s = typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 絞り込んだ監査ログを CSV にする（出力したことも監査ログに残す） */
export async function exportAuditLogs(f: AuditLogFilter, auth: AuthContext): Promise<{ csv: string; count: number; truncated: boolean }> {
  const [snap, names] = await Promise.all([baseQuery(auth.companyId, f).limit(CSV_MAX * 2).get(), namesOf(auth.companyId)]);
  const hits = snap.docs.filter((d) => matches(d.data(), f)).slice(0, CSV_MAX);
  const targets = await targetEmployees(auth.companyId, hits);
  const rows = hits.map((d) => toItem(d, names, targets));
  const header = ['通し番号', '日時', '操作者ID', '操作者', '対象の種類', '対象ID', '対象の従業員', '操作', '内容', 'IP', 'IPの記録'];
  const lines = rows.map((r) => [
    r.seq ?? '', new Date(r.performedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }), r.performedBy, r.performedByName,
    r.entity, r.entityId, r.targetEmployee, r.action, r.changes, r.ip, r.ip ? (r.ipEstimated ? '推定（セッションの IP）' : '操作の記録') : '',
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
