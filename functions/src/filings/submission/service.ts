import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { invalidArg, notFound } from '../../utils/errors';
import { FilingSource } from '../index/rules';
import {
  advanceDue, cancelMock, canSend, DEFAULT_MOCK_SETTINGS, employeeMirror, formatAcceptanceNumber, isInTransit, MOCK_STATUS_LABELS, MockSettings,
  MockState, PaperState, recordPaperResult, returnMock, runMirror, sendMock, stateOf, stepMock, submitPaper,
} from './rules';
import { FilingSubmissionActionInput, FilingTarget, MockSettingsInput } from './schema';

// 届出の提出（模擬電子申請・紙の提出）を、3か所の届出（従業員の下・算定基礎届・賞与支払届）で共通に扱う。
// 状態は届出の `mock`・`paper` に持ち、手続きや一括型の画面が読む旧来の項目（mockStatus・status など）にも写す。

const QUEUE = 'mockSubmissionQueue';
const queueId = (path: string) => path.replace(/\//g, '__');

function pathOf(companyId: string, t: FilingTarget): string {
  const col = t.source === 'employee' ? 'employees' : t.source === 'santei' ? 'santeiRuns' : 'bonusRuns';
  return `companies/${companyId}/${col}/${t.parentId}/filings/${t.filingId}`;
}

function sourceOf(path: string): { companyId: string; source: FilingSource; parentId: string; filingId: string } {
  const m = path.match(/^companies\/([^/]+)\/(employees|santeiRuns|bonusRuns)\/([^/]+)\/filings\/([^/]+)$/)!;
  return { companyId: m[1], source: m[2] === 'employees' ? 'employee' : m[2] === 'santeiRuns' ? 'santei' : 'bonus', parentId: m[3], filingId: m[4] };
}

const settingsRef = (companyId: string) => db.doc(`companies/${companyId}/settings/mockSubmission`);
const settingsOf = (snap: FirebaseFirestore.DocumentSnapshot): MockSettings => ({ ...DEFAULT_MOCK_SETTINGS, ...(snap.data() ?? {}) } as MockSettings);
const counterRef = (companyId: string, date: string) => db.doc(`companies/${companyId}/counters/mock-${date.replace(/-/g, '')}`);
const todayJst = (iso: string) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

const isApproved = (source: FilingSource, data: FirebaseFirestore.DocumentData) =>
  source === 'employee' ? data.workflowStatus === 'approved' : data.status === 'approved' || data.status === 'submitted';

/** 送信前に確かめる必須項目。足りないものの一覧 */
async function missingFields(source: FilingSource, data: FirebaseFirestore.DocumentData): Promise<string[]> {
  if (source === 'santei') return (await import('../../santei/service')).mockErrors(data);
  if (source === 'bonus') return (await import('../../bonus/service')).mockErrors(data);
  const { validateFormData } = await import('../filing-mock-submit/service');
  return validateFormData(data.filingType, data.formData ?? {});
}

/** 届出に書く項目（mock・paper と、旧来の項目への写し） */
function patchOf(source: FilingSource, data: FirebaseFirestore.DocumentData, mock: MockState | null, paper: PaperState | null): Record<string, unknown> {
  const patch: Record<string, unknown> = { mock, paper };
  if (source === 'employee') {
    Object.assign(patch, employeeMirror(mock, paper), {
      mockSubmittedAt: mock && mock.status !== 'cancelled' ? Timestamp.fromDate(new Date(mock.sentAt)) : null,
      submittedAt: paper ? Timestamp.fromDate(new Date(`${paper.submittedDate}T00:00:00+09:00`)) : null,
      resultReceivedAt: paper?.resultDate ? Timestamp.fromDate(new Date(`${paper.resultDate}T00:00:00+09:00`)) : null,
    });
  } else if (data.status === 'approved' || data.status === 'submitted') {
    Object.assign(patch, runMirror(mock, paper));
  }
  return patch;
}

/** 受付番号を採番する関数（トランザクションの中で、読み取り済みの日ごとの番号から数える） */
function numberer(companyId: string, date: string, counter: FirebaseFirestore.DocumentSnapshot, tx: FirebaseFirestore.Transaction) {
  let last = (counter.data()?.last ?? 0) as number;
  let used = false;
  return {
    next: () => { used = true; last += 1; return formatAcceptanceNumber(date, last); },
    commit: () => { if (used) tx.set(counterRef(companyId, date), { last, updatedAt: FieldValue.serverTimestamp() }, { merge: true }); },
  };
}

function syncQueue(tx: FirebaseFirestore.Transaction, path: string, companyId: string, mock: MockState | null) {
  const ref = db.collection(QUEUE).doc(queueId(path));
  if (mock && isInTransit(mock) && mock.auto && mock.nextAt) tx.set(ref, { path, companyId, dueAt: Timestamp.fromDate(new Date(mock.nextAt)) });
  else tx.delete(ref);
}

async function afterChange(path: string, before: MockState | null, after: MockState | null, by: string) {
  const src = sourceOf(path);
  if (src.source === 'employee') {
    const { refreshEmployeeProcedures } = await import('../../procedures/hooks');
    await refreshEmployeeProcedures(src.companyId, src.parentId);
  }
  // 模擬電子申請の結果（完了・返戻）はダッシュボードに通知する
  if (after && before?.status !== after.status && (after.status === 'completed' || after.status === 'returned')) {
    const { notify } = await import('../../utils/notify');
    await notify({
      companyId: src.companyId, category: 'filing', targetType: src.source === 'employee' ? 'filing' : `${src.source}Run`,
      targetId: src.source === 'employee' ? src.filingId : src.parentId, createdBy: by,
      title: after.status === 'completed' ? '模擬電子申請が完了しました' : '模擬電子申請が返戻されました',
      body: `受付番号 ${after.acceptanceNumber ?? '—'}${after.status === 'returned' ? `：${after.returnReason}` : ''}`,
    });
  }
}

/** 予定の時刻を過ぎていれば進める（画面が状態を読むとき・定期の処理から呼ぶ） */
export async function advanceIfDue(path: string): Promise<void> {
  const { companyId } = sourceOf(path);
  const ref = db.doc(path);
  const now = new Date().toISOString();
  const date = todayJst(now);
  const result = await db.runTransaction(async tx => {
    const [snap, settingsSnap, counter] = await Promise.all([tx.get(ref), tx.get(settingsRef(companyId)), tx.get(counterRef(companyId, date))]);
    if (!snap.exists) { tx.delete(db.collection(QUEUE).doc(queueId(path))); return null; }
    const data = snap.data()!;
    const { mock, paper } = stateOf(sourceOf(path).source, data);
    if (!mock || !isInTransit(mock) || !mock.auto || !mock.nextAt || mock.nextAt > now) return null;
    const n = numberer(companyId, date, counter, tx);
    const next = advanceDue(mock, { now, settings: settingsOf(settingsSnap), acceptanceNumber: n.next });
    if (next.status === mock.status) return null;
    n.commit();
    // 自動で進めたときは版を上げない（画面の操作の照合を邪魔しない）
    tx.update(ref, { ...patchOf(sourceOf(path).source, data, next, paper), updatedAt: Timestamp.now() });
    syncQueue(tx, path, companyId, next);
    return { before: mock, after: next };
  });
  if (result) await afterChange(path, result.before, result.after, 'system');
}

/** 定期の処理：予定の時刻を過ぎた送信中の届出を進める */
export async function processMockQueue(): Promise<number> {
  const due = await db.collection(QUEUE).where('dueAt', '<=', Timestamp.now()).limit(200).get();
  for (const d of due.docs) {
    try { await advanceIfDue(d.data().path as string); }
    catch (e) { console.error('mock advance failed', d.data().path, e); }
  }
  return due.size;
}

async function loadAndCheck(companyId: string, target: FilingTarget, auth: AuthContext) {
  const path = pathOf(companyId, target);
  const snap = await db.doc(path).get();
  if (!snap.exists) throw notFound('届出');
  const data = snap.data()!;
  const officeId = target.source === 'employee'
    ? ((await db.doc(`companies/${companyId}/employees/${target.parentId}`).get()).data()?.officeId as string | undefined)
    : (data.officeId as string | undefined);
  if (officeId) requireOffice(auth, officeId);
  return { path, data };
}

export interface SubmissionView {
  path: string;
  source: FilingSource;
  filingType: string;
  version: number;
  approved: boolean;
  /** 手続き側の状態（承認待ちなど）の説明 */
  workflowLabel: string;
  mock: MockState | null;
  mockLabel: string | null;
  paper: PaperState | null;
  submitted: boolean;
  canSend: boolean;
  canCancel: boolean;
  canPaper: boolean;
  canReopen: boolean;
  isAdmin: boolean;
  settings: MockSettings;
}

function viewOf(path: string, data: FirebaseFirestore.DocumentData, settings: MockSettings, auth: AuthContext): SubmissionView {
  const { source } = sourceOf(path);
  const { mock, paper } = stateOf(source, data);
  const approved = isApproved(source, data);
  const workflow = source === 'employee' ? data.workflowStatus : data.status;
  const labels: Record<string, string> = { draft: '下書き', pending: '承認待ち', rejected: '差戻し', approved: '承認済み', submitted: '提出済み', cancelled: '取消' };
  return {
    path, source, filingType: data.filingType, version: data.version ?? 0, approved,
    workflowLabel: labels[workflow] ?? workflow,
    mock, mockLabel: mock ? MOCK_STATUS_LABELS[mock.status] : null, paper,
    submitted: mock?.status === 'completed' || paper?.status === 'accepted' || (source !== 'employee' && !!paper && paper.status !== 'returned'),
    canSend: approved && canSend(mock) && paper?.status !== 'submitted' && paper?.status !== 'accepted',
    canCancel: mock?.status === 'sent',
    canPaper: approved && !isInTransit(mock) && (!paper || paper.status === 'returned'),
    canReopen: approved && (mock?.status === 'returned' || paper?.status === 'returned'),
    isAdmin: auth.roles.includes('admin'),
    settings,
  };
}

export async function getSubmission(input: { companyId: string } & FilingTarget, auth: AuthContext): Promise<SubmissionView> {
  const { path } = await loadAndCheck(auth.companyId, input, auth);
  await advanceIfDue(path);
  const [snap, settings] = await Promise.all([db.doc(path).get(), settingsRef(auth.companyId).get()]);
  return viewOf(path, snap.data()!, settingsOf(settings), auth);
}

const ADMIN_ONLY = new Set(['mockAdvance', 'mockReturn']);

/** 提出の操作。送信・送信取消・手動で進める・返戻（模擬）・紙の提出・紙の結果・出し直し */
export async function actOnSubmission(input: FilingSubmissionActionInput, auth: AuthContext): Promise<SubmissionView> {
  if (ADMIN_ONLY.has(input.action) && !auth.roles.includes('admin')) throw invalidArg('手動で進める・返戻にするのは管理者だけができます');
  if (!ADMIN_ONLY.has(input.action) && !auth.roles.some(r => r === 'admin' || r === 'operator')) throw invalidArg('提出の操作は管理者・担当者が行います');
  const { path, data: first } = await loadAndCheck(auth.companyId, input, auth);
  const { source } = sourceOf(path);
  const missing = input.action === 'mockSend' ? await missingFields(source, first) : [];
  const ref = db.doc(path);
  const now = new Date().toISOString();
  const date = todayJst(now);

  const result = await db.runTransaction(async tx => {
    const [snap, settingsSnap, counter] = await Promise.all([tx.get(ref), tx.get(settingsRef(auth.companyId)), tx.get(counterRef(auth.companyId, date))]);
    if (!snap.exists) throw notFound('届出');
    const data = snap.data()!;
    if (data.version !== input.expectedVersion) throw invalidArg('届出が更新されています。画面を読み込み直してください');
    const settings = settingsOf(settingsSnap);
    const view = viewOf(path, data, settings, auth);
    const before = view.mock;
    let mock = view.mock;
    let paper = view.paper;
    const n = numberer(auth.companyId, date, counter, tx);
    const extra: Record<string, unknown> = {};
    const guard = (ok: boolean, message: string) => { if (!ok) throw invalidArg(message); };
    try {
      switch (input.action) {
        case 'mockSend':
          guard(view.approved, '社内の承認が済んでいない届出は送信できません');
          guard(view.canSend, view.submitted ? 'この届出は提出済みです' : isInTransit(mock) ? 'この届出は送信中です（同じ届出を二重に送ることはできません）' : '紙で提出した届出は電子申請できません');
          mock = sendMock({ prev: mock, scenario: input.scenario ?? 'normal', missing, settings, now, uid: auth.uid });
          break;
        case 'mockCancel':
          guard(!!mock, 'まだ送信していません');
          mock = cancelMock(mock!, now, auth.uid);
          break;
        case 'mockAdvance':
          guard(isInTransit(mock), '送信中の届出だけ進められます');
          mock = stepMock(mock!, { now, by: auth.uid, settings, acceptanceNumber: n.next, manual: true });
          break;
        case 'mockReturn':
          guard(!!mock, 'まだ送信していません');
          mock = returnMock(mock!, input.note ?? '', now, auth.uid);
          break;
        case 'paperSubmit':
          guard(view.canPaper, view.approved ? '送信中の届出や、紙で提出済みの届出には記録できません' : '社内の承認が済んでいない届出は提出できません');
          guard(!!input.date, '提出した日を入れてください');
          paper = submitPaper(paper, { date: input.date!, office: input.office ?? '', method: input.method ?? 'counter', now, uid: auth.uid });
          break;
        case 'paperResult':
          guard(!!input.date && !!input.result, '結果と受け取った日を入れてください');
          paper = recordPaperResult(paper, { result: input.result!, date: input.date!, note: input.note ?? '', now, uid: auth.uid });
          break;
        case 'reopen':
          // 返戻された届出を下書きに戻し、直して承認からやり直す
          guard(view.canReopen, '返戻された届出だけ下書きに戻せます');
          if (mock?.status === 'returned') mock = { ...mock, status: 'cancelled', history: [...mock.history, { status: 'reopened', at: now, by: auth.uid, note: '返戻のため下書きに戻した' }] };
          Object.assign(extra, source === 'employee' ? { workflowStatus: 'draft' } : { status: 'draft', approvedBy: null, approvedAt: null, submission: null });
          break;
      }
    } catch (e) {
      if (e instanceof Error && !('code' in e)) throw invalidArg(e.message);
      throw e;
    }
    n.commit();
    tx.update(ref, { ...patchOf(source, { ...data, ...extra }, mock, paper), ...extra, updatedAt: Timestamp.now(), version: data.version + 1 });
    syncQueue(tx, path, auth.companyId, mock);
    tx.set(db.collection(`companies/${auth.companyId}/auditLogs`).doc(), {
      entity: source === 'employee' ? 'filing' : `${source}Filing`, entityId: sourceOf(path).filingId, action: 'update',
      changes: { [input.action]: { from: before?.status ?? paper?.status ?? null, to: mock?.status ?? null } },
      note: input.note ?? null, performedBy: auth.uid, performedAt: Timestamp.now(), version: data.version + 1,
    });
    return { before, after: mock };
  });
  await afterChange(path, result.before, result.after, auth.uid);
  const [snap, settings] = await Promise.all([ref.get(), settingsRef(auth.companyId).get()]);
  return viewOf(path, snap.data()!, settingsOf(settings), auth);
}

/** 模擬電子申請の待ち時間の設定。変更は管理者だけ */
export async function mockSettings(input: MockSettingsInput, auth: AuthContext): Promise<MockSettings> {
  const ref = settingsRef(auth.companyId);
  if (input.update) {
    if (!auth.roles.includes('admin')) throw invalidArg('設定を変えられるのは管理者だけです');
    await ref.set({ ...input.update, updatedBy: auth.uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
  const { updatedBy: _b, updatedAt: _a, ...rest } = settingsOf(await ref.get()) as MockSettings & { updatedBy?: unknown; updatedAt?: unknown };
  return rest;
}
