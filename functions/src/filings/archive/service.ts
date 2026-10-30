import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { invalidArg, notFound } from '../../utils/errors';
import { FilingIndexEntry } from '../index/rules';
import { loadAndCheck } from '../submission/service';
import { ArchiveDoc, buildArchive } from './rules';
import { ArchiveBatchInput, ArchiveGetInput, ArchiveListInput } from './schema';

// 届出の保存原本の一覧・取得と、ZIP の一括ダウンロード用のまとめての取り出し。
// PDF は画面で作る（同梱の様式に、原本の記入内容を書く）。

const iso = (v: unknown) => ((v as { toDate?: () => Date } | null)?.toDate?.().toISOString() ?? null);

async function nameOf(companyId: string, uid: string | null | undefined): Promise<string> {
  if (!uid) return '';
  return ((await db.doc(`companies/${companyId}/users/${uid}`).get()).data()?.displayName as string | undefined) ?? '';
}

export async function listArchives(input: ArchiveListInput, auth: AuthContext) {
  const { path } = await loadAndCheck(auth.companyId, input, auth);
  const snap = await db.collection(`${path}/archives`).orderBy('approvedAt', 'desc').get();
  return {
    items: await Promise.all(snap.docs.map(async d => {
      const a = d.data();
      return {
        id: d.id, approvedAt: iso(a.approvedAt), approvedByName: await nameOf(auth.companyId, a.approvedBy),
        filingVersion: a.filingVersion ?? 0, form: a.form ?? null, contentHash: a.contentHash,
      };
    })),
  };
}

/** 原本の中身（archiveId を省くと最新）。原本がなければ null */
export async function getArchive(input: ArchiveGetInput, auth: AuthContext) {
  const { path } = await loadAndCheck(auth.companyId, input, auth);
  const col = db.collection(`${path}/archives`);
  const snap = input.archiveId ? await col.doc(input.archiveId).get() : (await col.orderBy('approvedAt', 'desc').limit(1).get()).docs[0];
  if (!snap?.exists) return { archive: null };
  const a = snap.data()!;
  return { archive: { id: snap.id, ...(a as ArchiveDoc), approvedAt: iso(a.approvedAt), approvedByName: await nameOf(auth.companyId, a.approvedBy) } };
}

/** ZIP に入れる届出：承認済み以降（送信中・完了・紙で提出を含む）。取消・下書き・承認待ちは入れない */
const ZIP_STATUSES = new Set(['approved', 'sent', 'received', 'processing', 'completed', 'returned', 'mockFailed']);
const MAX_SCAN = 3000;

/**
 * 期間・届出の種類・事業所で選んだ届出の保存原本をまとめて返す（1回に limit 件まで。offset で続きを取る）。
 * 原本のない届出（7-7 より前に承認したもの）は、今の記入内容を current として返す
 */
export async function batchArchives(input: ArchiveBatchInput, auth: AuthContext) {
  if (input.officeId) requireOffice(auth, input.officeId);
  if (input.from > input.to) throw invalidArg('期間の始めと終わりが逆です');
  const col = db.collection(`companies/${auth.companyId}/filingIndex`);
  const query = input.officeId ? col.where('officeId', '==', input.officeId)
    : input.filingType ? col.where('filingType', '==', input.filingType)
      : col.orderBy('updatedAt', 'desc');
  const snap = await query.limit(MAX_SCAN).get();
  const dateOf = (e: FilingIndexEntry) => (input.base === 'submitted' ? e.submittedDate : e.createdDate);
  const matched = snap.docs.map(d => d.data() as FilingIndexEntry).filter(e => {
    if (!auth.roles.includes('admin') && !auth.officeIds.includes(e.officeId)) return false;
    if (input.officeId && e.officeId !== input.officeId) return false;
    if (input.filingType && e.filingType !== input.filingType) return false;
    if (!(ZIP_STATUSES.has(e.status) || e.paperStatus === 'submitted' || e.paperStatus === 'accepted')) return false;
    const d = dateOf(e);
    return !!d && d >= input.from && d <= input.to;
  }).sort((a, b) => (dateOf(a) ?? '').localeCompare(dateOf(b) ?? '') || a.path.localeCompare(b.path));

  const page = matched.slice(input.offset ?? 0, (input.offset ?? 0) + (input.limit ?? 30));
  const company = (await db.doc(`companies/${auth.companyId}`).get()).data() ?? null;
  const items = await Promise.all(page.map(async e => {
    const target = { source: e.source, parentId: e.parentId, filingId: e.filingId };
    const latest = (await db.collection(`${e.path}/archives`).orderBy('approvedAt', 'desc').limit(1).get()).docs[0];
    let archive: (ArchiveDoc & { approvedAt: string | null }) | null = null;
    let current = false;
    if (latest) archive = { ...(latest.data() as ArchiveDoc), approvedAt: iso(latest.data().approvedAt) };
    else {
      const filing = await db.doc(e.path).get();
      if (!filing.exists) throw notFound('届出');
      const employee = e.employeeId ? (await db.doc(`companies/${auth.companyId}/employees/${e.employeeId}`).get()).data() ?? null : null;
      const office = (await db.doc(`companies/${auth.companyId}/offices/${e.officeId}`).get()).data() ?? null;
      archive = { ...buildArchive({ source: e.source, data: filing.data()!, approvedBy: '', company, office, employee }), approvedAt: null };
      current = true;
    }
    return {
      target, filingType: e.filingType, employeeName: e.employeeName, employeeNumber: e.employeeNumber, officeName: e.officeName,
      number: e.number, year: e.year, payMonth: e.payMonth, date: dateOf(e), archive, current,
    };
  }));
  return { items, total: matched.length, truncated: snap.size >= MAX_SCAN };
}
