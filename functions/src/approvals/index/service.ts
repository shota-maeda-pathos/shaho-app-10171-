import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { todayJst } from '../../procedures/wizard';
import { stateOf, isInTransit } from '../../filings/submission/rules';
import { filingContentHash } from '../../utils/hash';
import { invalidArg, notFound } from '../../utils/errors';
import { mapConcurrent } from '../../utils/parallel';
import {
  ApprovalIndexEntry, buildRequestEntry, buildRunFilingEntry, diffSnapshots, isDueSoon, isOverdue, isStale,
} from './rules';
import { ApprovalBulkInput, ApprovalCancelInput, ApprovalDetailInput, ApprovalSearchInput, ApprovalSettingsInput, ApprovalTarget } from './schema';

// 承認の索引 companies/{c}/approvalIndex。従業員の下の承認申請と、算定基礎届・賞与支払届の承認を1つにそろえる。
// 横断の承認一覧・件数のバッジ・リマインドはこの索引だけを読む。

const indexCol = (companyId: string) => db.collection(`companies/${companyId}/approvalIndex`);
const requestIndexId = (employeeId: string, requestId: string) => `req_${employeeId}_${requestId}`;
const runIndexId = (source: string, parentId: string, filingId: string) => `${source}_${parentId}_${filingId}`;
const settingsRef = (companyId: string) => db.doc(`companies/${companyId}/settings/approval`);
const DEFAULT_STALE_DAYS = 3;

async function staleDaysOf(companyId: string): Promise<number> {
  return ((await settingsRef(companyId).get()).data()?.staleDays as number | undefined) ?? DEFAULT_STALE_DAYS;
}

const userName = async (companyId: string, uid: string | null | undefined) =>
  uid ? (await db.doc(`companies/${companyId}/users/${uid}`).get()).data() ?? null : null;

/** トリガーから呼ぶ：従業員の下の承認申請が書き換わったら索引を合わせる */
export async function syncRequestIndex(path: string, after: FirebaseFirestore.DocumentData | undefined) {
  const m = path.match(/^companies\/([^/]+)\/employees\/([^/]+)\/approvalRequests\/([^/]+)$/);
  if (!m) return;
  const [, companyId, employeeId, requestId] = m;
  const ref = indexCol(companyId).doc(requestIndexId(employeeId, requestId));
  if (!after) { await ref.delete(); return; }
  const employee = (await db.doc(`companies/${companyId}/employees/${employeeId}`).get()).data() ?? null;
  const [office, requester, target] = await Promise.all([
    employee?.officeId ? db.doc(`companies/${companyId}/offices/${employee.officeId}`).get().then(s => s.data() ?? null) : null,
    userName(companyId, after.requestedBy),
    after.requestType === 'filing' && after.targetPath ? db.doc(after.targetPath).get().then(s => s.data() ?? null) : null,
  ]);
  const entry = buildRequestEntry({ requestId, employeeId, data: after, employee, office, requester, target });
  await ref.set({ ...entry, indexedAt: FieldValue.serverTimestamp() });
}

/** 届出の索引のトリガーから呼ぶ：算定基礎届・賞与支払届の承認を索引に合わせる */
export async function syncRunFilingApproval(path: string, after: FirebaseFirestore.DocumentData | undefined) {
  const m = path.match(/^companies\/([^/]+)\/(santeiRuns|bonusRuns)\/([^/]+)\/filings\/([^/]+)$/);
  if (!m) return;
  const [, companyId, col, parentId, filingId] = m;
  const source = col === 'santeiRuns' ? 'santei' : 'bonus';
  const ref = indexCol(companyId).doc(runIndexId(source, parentId, filingId));
  const officeId = after?.officeId ?? parentId.replace(/_[^_]+$/, '');
  const [office, requester] = after
    ? await Promise.all([db.doc(`companies/${companyId}/offices/${officeId}`).get().then(s => s.data() ?? null), userName(companyId, after.requestedBy)])
    : [null, null];
  const entry = after ? buildRunFilingEntry({ source, parentId, filingId, path, data: after, office, requester }) : null;
  if (!entry) { await ref.delete(); return; }
  await ref.set({ ...entry, indexedAt: FieldValue.serverTimestamp() });
}

/** 既存の承認申請と run の届出を索引に入れ直す（移行用。管理者だけ） */
export async function rebuildApprovalIndex(auth: AuthContext) {
  if (!auth.roles.includes('admin')) throw invalidArg('索引の作り直しは管理者だけができます');
  const base = `companies/${auth.companyId}`;
  const [employees, santei, bonus, offices, users] = await Promise.all([
    db.collection(`${base}/employees`).get(), db.collection(`${base}/santeiRuns`).get(), db.collection(`${base}/bonusRuns`).get(),
    db.collection(`${base}/offices`).get(), db.collection(`${base}/users`).get(),
  ]);
  const officeMap = new Map(offices.docs.map(d => [d.id, d.data()]));
  const userMap = new Map(users.docs.map(d => [d.id, d.data()]));
  const live = new Set<string>();
  const entries: [string, ApprovalIndexEntry][] = [];
  const perEmployee = await mapConcurrent(employees.docs, 30, e => e.ref.collection('approvalRequests').get());
  const filingTargets = new Map<string, FirebaseFirestore.DocumentData>();
  const filingPaths = perEmployee.flatMap(s => s.docs).filter(r => r.data().requestType === 'filing').map(r => r.data().targetPath as string);
  for (let i = 0; i < filingPaths.length; i += 300) {
    const snaps = await db.getAll(...filingPaths.slice(i, i + 300).map(p => db.doc(p)));
    for (const s of snaps) if (s.exists) filingTargets.set(s.ref.path, s.data()!);
  }
  employees.docs.forEach((e, i) => {
    const employee = e.data();
    for (const r of perEmployee[i].docs) {
      const data = r.data();
      const entry = buildRequestEntry({
        requestId: r.id, employeeId: e.id, data, employee, office: officeMap.get(employee.officeId) ?? null,
        requester: userMap.get(data.requestedBy) ?? null, target: data.requestType === 'filing' ? filingTargets.get(data.targetPath) ?? null : null,
      });
      entries.push([requestIndexId(e.id, r.id), entry]);
    }
  });
  for (const [source, runs] of [['santei', santei], ['bonus', bonus]] as const) {
    const perRun = await mapConcurrent(runs.docs, 10, r => r.ref.collection('filings').get());
    runs.docs.forEach((run, i) => {
      for (const f of perRun[i].docs) {
        const data = f.data();
        const entry = buildRunFilingEntry({
          source, parentId: run.id, filingId: f.id, path: f.ref.path, data,
          office: officeMap.get(data.officeId ?? run.id.replace(/_[^_]+$/, '')) ?? null, requester: userMap.get(data.requestedBy) ?? null,
        });
        if (entry) entries.push([runIndexId(source, run.id, f.id), entry]);
      }
    });
  }
  let writer = db.batch();
  let pending = 0;
  const flush = async () => { if (pending) { await writer.commit(); writer = db.batch(); pending = 0; } };
  for (const [id, entry] of entries) {
    live.add(id);
    writer.set(indexCol(auth.companyId).doc(id), { ...entry, indexedAt: FieldValue.serverTimestamp() });
    if (++pending >= 400) await flush();
  }
  const stale = (await indexCol(auth.companyId).select().get()).docs.filter(d => !live.has(d.id));
  for (const d of stale) { writer.delete(d.ref); if (++pending >= 400) await flush(); }
  await flush();
  return { success: true, indexed: entries.length, removed: stale.length };
}

const canApproveRole = (auth: AuthContext) => auth.roles.includes('admin') || auth.roles.includes('approver');
const visible = (auth: AuthContext, e: ApprovalIndexEntry) => auth.roles.includes('admin') || auth.officeIds.includes(e.officeId);

export interface ApprovalSearchItem extends ApprovalIndexEntry {
  id: string;
  mine: boolean;
  canApprove: boolean;
  overdue: boolean;
  dueSoon: boolean;
  stale: boolean;
}

/** 横断の承認一覧。承認待ちは件数で切らず、期限の過ぎた・近いものから出す */
export async function searchApprovals(input: ApprovalSearchInput, auth: AuthContext) {
  if (input.officeId) requireOffice(auth, input.officeId);
  const today = todayJst();
  const now = new Date();
  const staleDays = await staleDaysOf(auth.companyId);
  const col = indexCol(auth.companyId);
  const snap = input.view === 'processed'
    ? await col.orderBy('indexedAt', 'desc').limit(800).get()
    : await col.where('status', '==', 'pending').limit(5000).get();
  const keyword = input.keyword?.replace(/\s+/g, '') ?? '';
  const all: ApprovalSearchItem[] = snap.docs.map(d => {
    const e = d.data() as ApprovalIndexEntry;
    const mine = e.requestedBy === auth.uid;
    return {
      ...e, id: d.id, mine, canApprove: e.status === 'pending' && canApproveRole(auth) && !mine,
      overdue: isOverdue(e, today), dueSoon: isDueSoon(e, today), stale: isStale(e, now, staleDays),
    };
  }).filter(e => visible(auth, e) && (input.view === 'processed' ? e.status !== 'pending' : true));
  const scoped = all.filter(e => !input.officeId || e.officeId === input.officeId);
  const summary = {
    pending: scoped.filter(e => e.status === 'pending').length,
    forMe: scoped.filter(e => e.canApprove).length,
    overdue: scoped.filter(e => e.overdue).length,
    stale: scoped.filter(e => e.stale).length,
    mine: scoped.filter(e => e.mine && e.status === 'pending').length,
  };
  const items = scoped.filter(e => {
    if (input.requestType && e.requestType !== input.requestType) return false;
    if (input.filingType && e.filingType !== input.filingType) return false;
    if (input.only === 'forMe' && !e.canApprove) return false;
    if (input.only === 'mine' && !e.mine) return false;
    if (input.only === 'overdue' && !e.overdue) return false;
    if (input.only === 'stale' && !e.stale) return false;
    if (keyword && !`${e.employeeName}${e.employeeNumber}${e.summary}`.replace(/\s+/g, '').includes(keyword)) return false;
    return true;
  });
  const byDeadline = (a: ApprovalSearchItem, b: ApprovalSearchItem) => {
    if (a.deadline && b.deadline && a.deadline !== b.deadline) return a.deadline < b.deadline ? -1 : 1;
    if (!!a.deadline !== !!b.deadline) return a.deadline ? -1 : 1;
    return (a.requestedAt ?? '').localeCompare(b.requestedAt ?? '');
  };
  if (input.view === 'processed') items.sort((a, b) => (b.reviewedAt ?? b.requestedAt ?? '').localeCompare(a.reviewedAt ?? a.requestedAt ?? ''));
  else if (input.sort === 'requestedAt') items.sort((a, b) => (a.requestedAt ?? '').localeCompare(b.requestedAt ?? ''));
  else if (input.sort === 'office') items.sort((a, b) => a.officeName.localeCompare(b.officeName, 'ja') || byDeadline(a, b));
  else items.sort(byDeadline);
  const limit = input.limit ?? (input.view === 'processed' ? 200 : 3000);
  return { items: items.slice(0, limit), total: items.length, summary, staleDays, today };
}

/** サイドバーのバッジ：自分が承認できる承認待ちの件数 */
export async function approvalBadge(auth: AuthContext) {
  if (!canApproveRole(auth)) return { forMe: 0 };
  const snap = await indexCol(auth.companyId).where('status', '==', 'pending').select('officeId', 'requestedBy').get();
  const forMe = snap.docs.filter(d => {
    const e = d.data();
    return e.requestedBy !== auth.uid && (auth.roles.includes('admin') || auth.officeIds.includes(e.officeId));
  }).length;
  return { forMe };
}

const runPath = (companyId: string, t: { source: 'santei' | 'bonus'; parentId: string; filingId: string }) =>
  `companies/${companyId}/${t.source === 'santei' ? 'santeiRuns' : 'bonusRuns'}/${t.parentId}/filings/${t.filingId}`;

/** 承認の中身：要点・記入内容・前回の版との差分・承認後の書き換えの有無・経緯 */
export async function approvalDetail(input: ApprovalDetailInput, auth: AuthContext) {
  const t = input.target;
  if (t.kind === 'runFiling') {
    const snap = await db.doc(runPath(auth.companyId, t)).get();
    if (!snap.exists) throw notFound('届出');
    const f = snap.data()!;
    if (f.officeId) requireOffice(auth, f.officeId);
    return {
      kind: t.kind, status: f.status, filingType: f.filingType,
      content: { ...(f.header ?? {}), 人数: (f.employeeIds ?? []).length },
      diff: [], previous: null,
      note: '算定基礎届・賞与支払届は、内容とPDFを一括型の画面で確かめてください。前回の版との差分はありません（差し戻しのあとは同じ届出をそのまま依頼し直します）。',
      tampered: !!f.approvedHash && f.approvedHash !== filingContentHash(f),
      changedSinceRequest: false,
      history: [],
    };
  }
  const empPath = `companies/${auth.companyId}/employees/${t.employeeId}`;
  const [empSnap, reqSnap] = await Promise.all([db.doc(empPath).get(), db.doc(`${empPath}/approvalRequests/${t.requestId}`).get()]);
  if (!empSnap.exists) throw notFound('従業員');
  requireOffice(auth, empSnap.data()!.officeId);
  if (!reqSnap.exists) throw notFound('承認申請');
  const req = reqSnap.data()!;
  const [targetSnap, siblings] = await Promise.all([
    req.targetPath ? db.doc(req.targetPath).get() : null,
    db.collection(`${empPath}/approvalRequests`).where('targetPath', '==', req.targetPath).get(),
  ]);
  const at = (d: FirebaseFirestore.DocumentData) => d.requestedAt?.toMillis?.() ?? 0;
  const ordered = siblings.docs.map(d => ({ id: d.id, ...d.data() } as FirebaseFirestore.DocumentData & { id: string })).sort((a, b) => at(a) - at(b));
  const idx = ordered.findIndex(d => d.id === t.requestId);
  const previous = idx > 0 ? ordered[idx - 1] : null;
  const target = targetSnap?.exists ? targetSnap.data()! : null;
  const content = (req.snapshotData?.formData ?? req.snapshotData ?? {}) as Record<string, unknown>;
  const users = new Map<string, string>();
  for (const uid of new Set(ordered.flatMap(d => [d.requestedBy, d.reviewedBy]).filter(Boolean) as string[])) {
    users.set(uid, (await userName(auth.companyId, uid))?.displayName ?? '');
  }
  return {
    kind: t.kind, status: req.status, requestType: req.requestType, filingType: target?.filingType ?? req.snapshotData?.filingType ?? null,
    content, metadata: req.metadata ?? null,
    diff: diffSnapshots(previous?.snapshotData ?? null, req.snapshotData ?? null),
    previous: previous ? { id: previous.id, status: previous.status, requestedAt: previous.requestedAt?.toDate?.().toISOString() ?? null, comment: previous.comment ?? null } : null,
    note: null,
    tampered: req.requestType === 'filing' && !!target?.approvedHash && target.approvedHash !== filingContentHash(target),
    changedSinceRequest: req.status === 'pending' && !!target && target.version !== req.targetVersion,
    history: ordered.map(d => ({
      id: d.id, status: d.status, requestedAt: d.requestedAt?.toDate?.().toISOString() ?? null, requestedBy: users.get(d.requestedBy) ?? '',
      reviewedAt: d.reviewedAt?.toDate?.().toISOString() ?? null, reviewedBy: d.reviewedBy ? users.get(d.reviewedBy) ?? '' : null,
      comment: d.comment ?? null, cancelReason: d.cancelReason ?? null,
    })),
  };
}

/** 一括承認。1件ずつ同じ確かめ方で承認し、できなかったものは理由を返す。監査ログと通知は1件にまとめる */
export async function bulkApprove(input: ApprovalBulkInput, auth: AuthContext) {
  if (!canApproveRole(auth)) throw invalidArg('承認できるのは管理者・承認者です');
  const { approveApprovalRequest } = await import('../approval-request-approve/service');
  const { refreshEmployeeProcedures } = await import('../../procedures/hooks');
  const results: { target: ApprovalTarget; ok: boolean; message: string | null }[] = [];
  const touched = new Set<string>();
  for (const t of input.items) {
    try {
      if (t.kind === 'request') {
        const req = (await db.doc(`companies/${auth.companyId}/employees/${t.employeeId}/approvalRequests/${t.requestId}`).get()).data();
        await approveApprovalRequest({ companyId: auth.companyId, employeeId: t.employeeId, requestId: t.requestId, comment: input.comment }, auth, { notify: false });
        if (req?.requestType === 'filing' || req?.requestType === 'employment' || req?.requestType === 'grade') touched.add(t.employeeId);
      } else {
        await approveRunFiling(t, auth, input.comment);
      }
      results.push({ target: t, ok: true, message: null });
    } catch (e) {
      results.push({ target: t, ok: false, message: e instanceof Error ? e.message : String(e) });
    }
  }
  for (const employeeId of touched) await refreshEmployeeProcedures(auth.companyId, employeeId);
  const ok = results.filter(r => r.ok).length;
  const now = Timestamp.now();
  await db.collection(`companies/${auth.companyId}/auditLogs`).doc().set({
    entity: 'approvalBulk', entityId: 'bulk', action: 'approve',
    changes: { approved: { from: input.items.length, to: ok } },
    items: results.map(r => ({ ...r.target, ok: r.ok, message: r.message })),
    note: input.comment ?? null, performedBy: auth.uid, performedAt: now, version: 1,
  });
  if (ok) {
    const { notify } = await import('../../utils/notify');
    await notify({
      companyId: auth.companyId, category: 'approval', targetType: 'approvalBulk', createdBy: auth.uid,
      title: '承認しました（まとめて）', body: `${ok}件をまとめて承認しました${ok < results.length ? `（${results.length - ok}件はできませんでした）` : ''}`,
    });
  }
  return { results, approved: ok };
}

async function approveRunFiling(t: Extract<ApprovalTarget, { kind: 'runFiling' }>, auth: AuthContext, comment?: string) {
  const f = (await db.doc(runPath(auth.companyId, t)).get()).data();
  if (!f) throw notFound('届出');
  const officeId = (f.officeId as string) ?? t.parentId.replace(/_[^_]+$/, '');
  if (t.source === 'santei') {
    const { updateSanteiFiling } = await import('../../santei/service');
    await updateSanteiFiling({ companyId: auth.companyId, officeId, year: f.year, filingId: t.filingId, expectedVersion: f.version, action: 'approve', comment }, auth);
  } else {
    const { updateBonusFiling } = await import('../../bonus/service');
    await updateBonusFiling({ companyId: auth.companyId, officeId, payMonth: f.payMonth, filingId: t.filingId, expectedVersion: f.version, action: 'approve', comment }, auth);
  }
}

/**
 * 承認の取消（届出だけ）。承認済みでまだ送信・提出していない届出を下書きに戻す。
 * 届出の承認で確定した等級・免除も元に戻す。その等級・免除で保険料を計算した月があれば取り消さない
 */
export async function cancelApproval(input: ApprovalCancelInput, auth: AuthContext) {
  if (!auth.roles.some(r => r === 'admin' || r === 'approver' || r === 'operator')) throw invalidArg('承認を取り消せるのは管理者・承認者・担当者です');
  const reason = input.reason.trim();
  if (!reason) throw invalidArg('取り消す理由を入れてください');
  const t = input.target;
  const now = Timestamp.now();
  const notSubmitted = (source: 'employee' | 'santei' | 'bonus', data: FirebaseFirestore.DocumentData) => {
    const { mock, paper } = stateOf(source, data);
    if (isInTransit(mock) || mock?.status === 'completed' || mock?.status === 'returned') throw invalidArg('模擬電子申請で送信した届出は承認を取り消せません（受付前なら先に送信を取り消します。受付後は訂正届で直します）');
    if (paper && paper.status !== 'returned') throw invalidArg('紙で提出した届出は承認を取り消せません（訂正届で直します）');
  };

  if (t.kind === 'runFiling') {
    const ref = db.doc(runPath(auth.companyId, t));
    await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw notFound('届出');
      const f = snap.data()!;
      if (f.officeId) requireOffice(auth, f.officeId);
      if (f.status !== 'approved') throw invalidArg('承認済み（提出前）の届出だけ承認を取り消せます');
      notSubmitted(t.source, f);
      tx.update(ref, {
        status: 'draft', approvedBy: null, approvedAt: null, approvedHash: null, rejection: null, mock: null,
        approvalCancelledAt: now, approvalCancelledBy: auth.uid, approvalCancelReason: reason, updatedAt: now, version: f.version + 1,
      });
      tx.set(db.collection(`companies/${auth.companyId}/auditLogs`).doc(), {
        entity: `${t.source}Filing`, entityId: t.filingId, action: 'cancelApproval', changes: { status: { from: 'approved', to: 'draft' } },
        note: reason, performedBy: auth.uid, performedAt: now, version: f.version + 1,
      });
    });
    return { success: true };
  }

  const empPath = `companies/${auth.companyId}/employees/${t.employeeId}`;
  const emp = await db.doc(empPath).get();
  if (!emp.exists) throw notFound('従業員');
  requireOffice(auth, emp.data()!.officeId);
  const reqRef = db.doc(`${empPath}/approvalRequests/${t.requestId}`);
  await db.runTransaction(async tx => {
    const reqSnap = await tx.get(reqRef);
    if (!reqSnap.exists) throw notFound('承認申請');
    const req = reqSnap.data()!;
    if (req.requestType !== 'filing') throw invalidArg('承認を取り消せるのは届出だけです（給与・保険料・等級は、それぞれの画面で計算し直して承認を依頼し直します）');
    if (req.status !== 'approved') throw invalidArg('承認済みの申請だけ取り消せます');
    const filingRef = db.doc(req.targetPath);
    const filingId = filingRef.id;
    const [filingSnap, insurance, exemptions] = await Promise.all([
      tx.get(filingRef), tx.get(db.collection(`${empPath}/monthlyInsurance`)), tx.get(db.collection(`${empPath}/premiumExemptions`).where('filingId', '==', filingId)),
    ]);
    if (!filingSnap.exists) throw notFound('届出');
    const filing = filingSnap.data()!;
    if (filing.workflowStatus !== 'approved') throw invalidArg('この届出は承認済みではありません');
    notSubmitted('employee', filing);
    const calculated = insurance.docs.map(d => d.id).sort();
    const grade = req.metadata?.grade as { path?: string; effectiveMonth?: string } | undefined;
    let gradeRef: FirebaseFirestore.DocumentReference | null = null;
    if (grade?.path) {
      gradeRef = db.doc(grade.path);
      const g = await tx.get(gradeRef);
      if (!g.exists || g.data()!.approvalRequestId !== t.requestId) gradeRef = null;
      const used = calculated.find(m => grade.effectiveMonth && m >= grade.effectiveMonth);
      if (gradeRef && used) throw invalidArg(`この届出で確定した等級を使って${used}分の保険料を計算済みのため、承認を取り消せません。訂正届で直してください`);
    }
    const activeExemptions = exemptions.docs.filter(d => d.data().status !== 'pending' || d.data().approvedAt);
    for (const ex of exemptions.docs) {
      const { startMonth, endMonth } = ex.data();
      const used = calculated.find(m => m >= startMonth && m <= endMonth);
      if (used) throw invalidArg(`この届出の免除を使って${used}分の保険料を計算済みのため、承認を取り消せません。訂正届で直してください`);
    }
    tx.update(reqRef, { status: 'cancelled', cancelledBy: auth.uid, cancelledAt: now, cancelReason: reason, updatedAt: now });
    tx.update(filingRef, { workflowStatus: 'draft', approvedHash: null, mock: null, mockStatus: 'notStarted', updatedAt: now, version: filing.version + 1 });
    if (gradeRef) tx.delete(gradeRef);
    for (const ex of activeExemptions) tx.update(ex.ref, { status: 'pending', approvedAt: null, updatedAt: now });
    tx.set(db.collection(`companies/${auth.companyId}/auditLogs`).doc(), {
      entity: 'approvalRequest', entityId: t.requestId, action: 'cancelApproval',
      changes: { status: { from: 'approved', to: 'cancelled' }, ...(gradeRef ? { grade: { from: gradeRef.path, to: null } } : {}), ...(activeExemptions.length ? { exemption: { from: activeExemptions.length, to: 0 } } : {}) },
      note: reason, performedBy: auth.uid, performedAt: now, version: filing.version + 1,
    });
  });
  const { refreshEmployeeProcedures } = await import('../../procedures/hooks');
  await refreshEmployeeProcedures(auth.companyId, t.employeeId);
  const { notify } = await import('../../utils/notify');
  await notify({
    companyId: auth.companyId, category: 'approval', targetType: 'approvalRequest', targetId: t.requestId, createdBy: auth.uid,
    title: '承認を取り消しました', body: `届出の承認を取り消し、下書きに戻しました：${reason}`,
  });
  return { success: true };
}

/** 放置とみなす日数の設定（読むのは全員、変えるのは管理者） */
export async function approvalSettings(input: ApprovalSettingsInput, auth: AuthContext) {
  if (input.update) {
    if (!auth.roles.includes('admin')) throw invalidArg('設定を変えられるのは管理者だけです');
    await settingsRef(auth.companyId).set({ staleDays: input.update.staleDays, updatedBy: auth.uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
  return { staleDays: await staleDaysOf(auth.companyId) };
}

/**
 * 毎朝のリマインド：期限を過ぎた・近い承認待ちと、長く止まっている承認待ちを、承認者向けにダッシュボードへ通知する（1日1回）
 */
export async function remindApprovals(): Promise<number> {
  const companies = await db.collection('companies').select().get();
  const today = todayJst();
  const now = new Date();
  let sent = 0;
  for (const c of companies.docs) {
    const settings = (await settingsRef(c.id).get()).data() ?? {};
    if (settings.lastReminderDate === today) continue;
    const staleDays = (settings.staleDays as number | undefined) ?? DEFAULT_STALE_DAYS;
    const pending = (await indexCol(c.id).where('status', '==', 'pending').get()).docs.map(d => d.data() as ApprovalIndexEntry);
    const overdue = pending.filter(e => isOverdue(e, today)).length;
    const soon = pending.filter(e => isDueSoon(e, today)).length;
    const stale = pending.filter(e => isStale(e, now, staleDays)).length;
    await settingsRef(c.id).set({ lastReminderDate: today }, { merge: true });
    if (!overdue && !soon && !stale) continue;
    const parts = [overdue && `期限を過ぎたもの${overdue}件`, soon && `期限が2日以内のもの${soon}件`, stale && `${staleDays}日以上止まっているもの${stale}件`].filter(Boolean);
    const { notify } = await import('../../utils/notify');
    await notify({
      companyId: c.id, category: 'approval', targetType: 'approvalReminder', createdBy: 'system',
      title: '承認待ちの確認をお願いします', body: `承認待ち${pending.length}件のうち、${parts.join('、')}があります。承認の画面で確かめてください。`,
    });
    sent += 1;
  }
  return sent;
}
