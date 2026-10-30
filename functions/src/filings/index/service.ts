import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { addDays } from '../../insurance/calculator';
import { todayJst } from '../../procedures/wizard';
import { invalidArg } from '../../utils/errors';
import { mapConcurrent } from '../../utils/parallel';
import { buildIndexEntry, FilingIndexEntry, FilingSource, indexIdOf, isOverdue } from './rules';
import { FilingSearchInput } from './schema';

// 届出の索引 companies/{c}/filingIndex。3か所の届出の書き込みをトリガーが受けて更新する。
// 横断の一覧・検索はこの索引だけを読む（従業員を1人ずつ読まない）。

const indexCol = (companyId: string) => db.collection(`companies/${companyId}/filingIndex`);

/** 届出のパスから、索引の元（どこの届出か）を読み取る */
export function sourceOfPath(path: string): { companyId: string; source: FilingSource; parentId: string; filingId: string } | null {
  const m = path.match(/^companies\/([^/]+)\/(employees|santeiRuns|bonusRuns)\/([^/]+)\/filings\/([^/]+)$/);
  if (!m) return null;
  const source: FilingSource = m[2] === 'employees' ? 'employee' : m[2] === 'santeiRuns' ? 'santei' : 'bonus';
  return { companyId: m[1], source, parentId: m[3], filingId: m[4] };
}

async function entryOf(path: string, data: FirebaseFirestore.DocumentData): Promise<FilingIndexEntry | null> {
  const src = sourceOfPath(path);
  if (!src) return null;
  const base = `companies/${src.companyId}`;
  const employee = src.source === 'employee' ? (await db.doc(`${base}/employees/${src.parentId}`).get()).data() ?? null : null;
  const officeId = src.source === 'employee' ? employee?.officeId : data.officeId ?? src.parentId.replace(/_[^_]+$/, '');
  const office = officeId ? (await db.doc(`${base}/offices/${officeId}`).get()).data() ?? null : null;
  return buildIndexEntry(data, { ...src, path, employee, office, runOfficeId: officeId });
}

/** トリガーから呼ぶ：届出が書き換わったら索引を合わせる（消えたら索引も消す） */
export async function syncFilingIndex(path: string, after: FirebaseFirestore.DocumentData | undefined) {
  const src = sourceOfPath(path);
  if (!src) return;
  const ref = indexCol(src.companyId).doc(indexIdOf(src.source, src.parentId, src.filingId));
  if (!after) {
    await ref.delete();
    if (src.source !== 'employee') await (await import('../../approvals/index/service')).syncRunFilingApproval(path, undefined);
    return;
  }
  const entry = await entryOf(path, after);
  if (entry) await ref.set({ ...entry, updatedAt: FieldValue.serverTimestamp() });
  // 算定基礎届・賞与支払届は承認も届出の status で持つため、承認の索引もここで合わせる
  if (src.source !== 'employee') await (await import('../../approvals/index/service')).syncRunFilingApproval(path, after);
}

/** 既存の届出をすべて索引に入れ直す（移行用。管理者だけ） */
export async function rebuildFilingIndex(auth: AuthContext) {
  if (!auth.roles.includes('admin')) throw invalidArg('索引の作り直しは管理者だけができます');
  const base = `companies/${auth.companyId}`;
  const [employees, santei, bonus] = await Promise.all([
    db.collection(`${base}/employees`).get(),
    db.collection(`${base}/santeiRuns`).get(),
    db.collection(`${base}/bonusRuns`).get(),
  ]);
  const parents = [...employees.docs, ...santei.docs, ...bonus.docs];
  const offices = new Map((await db.collection(`${base}/offices`).get()).docs.map(d => [d.id, d.data()]));
  const employeeData = new Map(employees.docs.map(d => [d.id, d.data()]));
  const live = new Set<string>();
  let writer = db.batch();
  let pending = 0;
  let written = 0;
  // 従業員ごとの読み込みを並行させる（順に読むと2000名で数分かかる）
  const perParent = await mapConcurrent(parents, 30, p => p.ref.collection('filings').get());
  for (const filings of perParent) {
    for (const f of filings.docs) {
      const src = sourceOfPath(f.ref.path);
      if (!src) continue;
      const employee = src.source === 'employee' ? employeeData.get(src.parentId) ?? null : null;
      const data = f.data();
      const officeId = src.source === 'employee' ? employee?.officeId : data.officeId ?? src.parentId.replace(/_[^_]+$/, '');
      const entry = buildIndexEntry(data, { ...src, path: f.ref.path, employee, office: offices.get(officeId) ?? null, runOfficeId: officeId });
      const id = indexIdOf(src.source, src.parentId, src.filingId);
      live.add(id);
      writer.set(indexCol(auth.companyId).doc(id), { ...entry, updatedAt: FieldValue.serverTimestamp() });
      written += 1;
      if (++pending >= 400) { await writer.commit(); writer = db.batch(); pending = 0; }
    }
  }
  // 元の届出が消えた索引を掃除する
  const stale = (await indexCol(auth.companyId).select().get()).docs.filter(d => !live.has(d.id));
  for (const d of stale) {
    writer.delete(d.ref);
    if (++pending >= 400) { await writer.commit(); writer = db.batch(); pending = 0; }
  }
  if (pending) await writer.commit();
  return { success: true, indexed: written, removed: stale.length };
}

const MAX_READ = 5000;

export interface FilingSearchItem extends FilingIndexEntry {
  id: string;
  overdue: boolean;
}

export interface FilingSearchResponse {
  items: FilingSearchItem[];
  /** 条件に合う件数（items は limit で切る） */
  total: number;
  /** 読み込みの上限で切った（条件を絞ってほしい） */
  truncated: boolean;
  summary: { open: number; overdue: number; dueSoon: number; pending: number };
  today: string;
}

/** 届出の横断検索。等価条件を1つだけ Firestore に渡し（複合索引を使わない）、残りはここで絞る */
export async function searchFilings(input: FilingSearchInput, auth: AuthContext): Promise<FilingSearchResponse> {
  if (input.officeId) requireOffice(auth, input.officeId);
  const today = todayJst();
  const soon = addDays(today, 6);
  const col = indexCol(auth.companyId);
  const visible = (e: FilingIndexEntry) => auth.roles.includes('admin') || auth.officeIds.includes(e.officeId);

  const byOpen = input.view === 'open' || input.view === 'overdue' || input.view === 'dueSoon';
  let query: FirebaseFirestore.Query;
  if (input.acceptanceNumber) query = col.where('acceptanceNumber', '==', input.acceptanceNumber.trim());
  else if (input.employeeId) query = col.where('employeeId', '==', input.employeeId);
  else if (byOpen) query = col.where('open', '==', true);
  else if (input.status) query = col.where('status', '==', input.status);
  else if (input.filingType) query = col.where('filingType', '==', input.filingType);
  else if (input.officeId) query = col.where('officeId', '==', input.officeId);
  else query = col.orderBy('updatedAt', 'desc');

  const [snap, openSnap] = await Promise.all([
    query.limit(MAX_READ).get(),
    col.where('open', '==', true).limit(MAX_READ).get(),
  ]);

  const openEntries = openSnap.docs.map(d => d.data() as FilingIndexEntry)
    .filter(e => visible(e) && (!input.officeId || e.officeId === input.officeId));
  const summary = {
    open: openEntries.length,
    overdue: openEntries.filter(e => isOverdue(e, today)).length,
    dueSoon: openEntries.filter(e => !!e.deadline && e.deadline >= today && e.deadline <= soon).length,
    pending: openEntries.filter(e => e.status === 'pending').length,
  };

  const keyword = input.keyword?.trim().replace(/\s+/g, '') ?? '';
  const periodValue = (e: FilingIndexEntry) =>
    input.period?.base === 'submitted' ? e.submittedDate : input.period?.base === 'deadline' ? e.deadline : e.createdDate;

  type Stored = FilingIndexEntry & { id: string; updatedAt?: { toMillis?: () => number } };
  const matched = snap.docs.map((d): Stored => ({ id: d.id, ...(d.data() as FilingIndexEntry) })).filter(e => {
    if (!visible(e)) return false;
    if (input.officeId && e.officeId !== input.officeId) return false;
    if (input.employeeId && e.employeeId !== input.employeeId) return false;
    if (input.filingType && e.filingType !== input.filingType) return false;
    if (input.status && e.status !== input.status) return false;
    if (input.paperStatus && e.paperStatus !== input.paperStatus) return false;
    if (byOpen && !e.open) return false;
    if (input.view === 'overdue' && !isOverdue(e, today)) return false;
    if (input.view === 'dueSoon' && !(e.deadline && e.deadline >= today && e.deadline <= soon)) return false;
    if (input.acceptanceNumber && e.acceptanceNumber !== input.acceptanceNumber.trim()) return false;
    if (keyword && !`${e.employeeName}${e.employeeNumber}`.replace(/\s+/g, '').includes(keyword)) return false;
    if (input.period?.from || input.period?.to) {
      const v = periodValue(e);
      if (!v) return false;
      if (input.period.from && v < input.period.from) return false;
      if (input.period.to && v > input.period.to) return false;
    }
    return true;
  });

  // 期限のあるものは期限の近い順（期限超過が先頭）、期限のないものは後ろで新しい順
  const updated = (e: Stored) => e.updatedAt?.toMillis?.() ?? 0;
  matched.sort((a, b) => {
    if (input.sort === 'updated') return updated(b) - updated(a);
    if (a.open !== b.open) return a.open ? -1 : 1;
    if (a.deadline && b.deadline && a.deadline !== b.deadline) return a.deadline < b.deadline ? -1 : 1;
    if (!!a.deadline !== !!b.deadline) return a.deadline ? -1 : 1;
    return updated(b) - updated(a);
  });

  const limit = input.limit ?? 200;
  const items = matched.slice(0, limit).map(({ updatedAt: _u, ...rest }) => ({ ...rest, overdue: isOverdue(rest, today) }));
  return { items, total: matched.length, truncated: snap.size >= MAX_READ, summary, today };
}
