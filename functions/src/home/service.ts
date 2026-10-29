import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../config';
import { AuthContext, requireOffice } from '../middleware/auth';
import { OfficeDoc, ProcedureDoc, ProcedureStep } from '../types/firestore';
import { addMonths } from '../insurance/calculator';
import { acquisitionFilingDeadline, currentWizardStep } from '../onboarding/service';
import { monthlyOverview, runId } from '../monthly/service';
import { mapConcurrent } from '../utils/parallel';
import { HomeTodo, TodoTone, payDateOf, sortTodos } from './rules';
import { monthlyProgress } from './monthly-progress';

const iso = (v: unknown) => (v as Timestamp | undefined)?.toDate?.().toISOString() ?? null;
const date = (v: unknown) => iso(v)?.slice(0, 10) ?? null;

/** 東京の今日の年月 */
function currentMonthJst() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }).slice(0, 7);
}

const isApprover = (auth: AuthContext) => auth.roles.some(r => r === 'admin' || r === 'approver');
const isOperator = (auth: AuthContext) => auth.roles.some(r => r === 'admin' || r === 'operator');

/**
 * 承認待ちの件の状態色。自分が依頼したものは自分では承認できないので「待ち」にする
 */
function approvalTone(auth: AuthContext, requestedBy: string | null | undefined): TodoTone {
  return isApprover(auth) && requestedBy !== auth.uid ? 'yours' : 'waiting';
}

// ── 入社・そのほかの手続き ───────────────────────────────

const ONBOARDING_NEXT: Record<string, string> = {
  register: '本人の入力を確かめて台帳に登録する',
  contract: '雇用条件を入れる',
  filing: '等級を確かめて資格取得届を作る',
  submit: '資格取得届を提出する',
  confirm: '完了を確認する',
};

async function onboardingTodo(p: ProcedureDoc & { id: string }, auth: AuthContext, officeName: string): Promise<HomeTodo | null> {
  const ob = p.onboarding!;
  const step = currentWizardStep(p);
  const base: Omit<HomeTodo, 'next' | 'detail' | 'tone' | 'deadline'> = {
    id: `procedure-${p.id}`, kind: 'onboarding', title: `${ob.plannedName || p.employeeName}さんの入社`, officeName,
    route: `/onboarding/${p.id}`, queryParams: { officeId: p.officeId }, updatedAt: iso(p.updatedAt),
  };
  // 提出が済めば資格取得届の期限は関係ない
  const deadline = step === 'confirm' || step === 'done' ? null : acquisitionFilingDeadline(ob.hireDate);
  if (ob.hold) return { ...base, next: '保留中', detail: `理由：${ob.hold.reason}`, tone: 'waiting', deadline };

  if (step === 'invite') {
    return { ...base, next: '本人の入力を待っています', detail: '届かないときは、担当者が代わりに入力できます', tone: 'waiting', deadline };
  }
  if (step === 'approval') {
    const refs = p.references.filter(r => r.type === 'approval' && r.stepId === 'approval');
    const approvalId = refs.length ? refs[refs.length - 1].documentId : null;
    const approval = p.employeeId && approvalId
      ? (await db.doc(`companies/${auth.companyId}/employees/${p.employeeId}/approvalRequests/${approvalId}`).get()).data()
      : undefined;
    if (approval?.status === 'rejected') {
      return { ...base, next: '差し戻された資格取得届を直す', detail: approval.comment ? `理由：${approval.comment}` : null, tone: 'action', deadline };
    }
    const tone = approvalTone(auth, approval?.requestedBy);
    return { ...base, next: tone === 'yours' ? '資格取得届を承認する' : '承認者の確認を待っています', detail: null, tone, deadline };
  }
  const returned = p.steps.find(s => s.status === 'returned');
  if (returned) return { ...base, next: '返戻された資格取得届を直す', detail: returned.statusDetail, tone: 'action', deadline };
  const next = ONBOARDING_NEXT[step];
  return next ? { ...base, next, detail: null, tone: 'yours', deadline } : null;
}

/** 入社以外の手続き（段階6でウィザードに置き換える）。次のステップを出す */
function procedureTodo(p: ProcedureDoc & { id: string }, auth: AuthContext, officeName: string): HomeTodo | null {
  const order: ProcedureStep['status'][] = ['returned', 'in_progress', 'available'];
  const step = order.map(status => p.steps.find(s => s.status === status)).find(Boolean);
  if (!step) return null;
  const tone: TodoTone = step.status === 'returned' ? 'action' : step.type === 'approval' && step.status === 'in_progress' ? approvalTone(auth, null) : 'yours';
  return {
    id: `procedure-${p.id}`, kind: 'procedure', title: p.title, officeName,
    next: step.status === 'returned' ? `${step.label}（差し戻し）` : tone === 'waiting' ? '承認者の確認を待っています' : step.label,
    detail: step.statusDetail ?? (p.statusReason || null), tone, deadline: date(p.deadline),
    route: `/procedures/${p.id}`, queryParams: { officeId: p.officeId }, updatedAt: iso(p.updatedAt),
  };
}

async function procedureTodos(auth: AuthContext, inScope: (officeId: string) => boolean, officeName: (id: string) => string) {
  // 等価条件だけにして複合索引に頼らない
  const snap = await db.collection(`companies/${auth.companyId}/procedures`)
    .where('status', '==', 'in_progress').where('deletedAt', '==', null).limit(1000).get();
  const procs = snap.docs.map(d => ({ id: d.id, ...(d.data() as ProcedureDoc) }))
    .filter(p => inScope(p.officeId) && (!p.targetOfficeId || inScope(p.targetOfficeId)));
  const todos = await mapConcurrent(procs, 10, p => p.onboarding ? onboardingTodo(p, auth, officeName(p.officeId)) : Promise.resolve(procedureTodo(p, auth, officeName(p.officeId))));
  return todos.filter((t): t is HomeTodo => t !== null);
}

// ── 毎月の処理 ─────────────────────────────────────────

function monthLabel(ym: string) { const [y, m] = ym.split('-'); return `${y}年${Number(m)}月`; }

/**
 * 事業所ごとの毎月の処理。当月分は必ず、前後の月は始めていて終わっていないものだけ出す。
 * 次にやることは、毎月の処理の画面と同じ判定で全員分の状況から決める（最後の一括処理からの推測はしない）
 */
async function monthlyTodos(auth: AuthContext, offices: { id: string; data: OfficeDoc }[]) {
  const base = `companies/${auth.companyId}`;
  const current = currentMonthJst();
  const months = [addMonths(current, -1), current, addMonths(current, 1)];
  const runs = await db.getAll(...offices.flatMap(o => months.map(m => db.doc(`${base}/monthlyRuns/${runId(o.id, m)}`))));
  const targets = offices.flatMap((office, i) => months
    .filter((m, j) => m === current || runs[i * months.length + j].data()?.latestJobId)
    .map(payMonth => ({ office, payMonth })));

  const todos = await mapConcurrent(targets, 6, async ({ office, payMonth }): Promise<HomeTodo | null> => {
    const todo = {
      id: `monthly-${office.id}-${payMonth}`, kind: 'monthly' as const, title: `毎月の処理（${monthLabel(payMonth)}支給）`,
      officeName: office.data.name, deadline: payDateOf(payMonth, office.data.paymentDay),
      route: '/monthly', queryParams: { officeId: office.id, payMonth },
    };
    let overview: Awaited<ReturnType<typeof monthlyOverview>>;
    try {
      overview = await monthlyOverview({ companyId: auth.companyId, officeId: office.id, payMonth }, auth);
    } catch (e) {
      // 1つの事業所が読めなくても、ほかのやることは出す
      return { ...todo, next: '状況を読み込めませんでした', detail: (e as Error).message || null, tone: 'action', updatedAt: null };
    }
    const job = overview.job;
    if (job?.status === 'stalled') return { ...todo, updatedAt: job.createdAt, next: `${job.label}が途中で止まりました`, detail: '毎月の処理の画面で、もう一度実行してください', tone: 'action' };
    if (job?.status === 'running') return { ...todo, updatedAt: job.createdAt, next: `${job.label}を処理しています（${job.processed}/${job.total}名）`, detail: null, tone: 'waiting' };
    const progress = monthlyProgress({ rows: overview.rows, reviews: overview.reviews, canApprove: overview.me.canApprove });
    if (!progress) return null;
    const failed = job && job.failed > 0 ? `直前の${job.label}で${job.failed}名が失敗しました` : null;
    return { ...todo, updatedAt: job?.createdAt ?? null, ...progress, detail: [failed, progress.detail].filter(Boolean).join('／') || null };
  });
  return todos.filter((t): t is HomeTodo => t !== null);
}

// ── まとめ ───────────────────────────────────────────

/**
 * ホームのやることリスト。進行中の手続き（入社など）と、事業所ごとの毎月の処理を、次にやることと期限つきで返す。
 * 承認者だけの人には、承認を頼まれているものだけを返す。
 */
export async function listHomeTodos(auth: AuthContext, officeId?: string) {
  if (officeId) requireOffice(auth, officeId);
  const officeSnap = await db.collection(`companies/${auth.companyId}/offices`).where('isActive', '==', true).get();
  const offices = officeSnap.docs
    .map(d => ({ id: d.id, data: d.data() as OfficeDoc }))
    .filter(o => (!officeId || o.id === officeId) && (auth.roles.includes('admin') || auth.officeIds.includes(o.id)));
  const names = new Map(offices.map(o => [o.id, o.data.name]));
  const inScope = (id: string) => names.has(id);

  const [procedures, monthly] = await Promise.all([
    procedureTodos(auth, inScope, id => names.get(id) ?? ''),
    monthlyTodos(auth, offices),
  ]);
  let items = [...procedures, ...monthly];
  if (!isOperator(auth)) items = items.filter(t => t.tone === 'yours');
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  return { today, items: sortTodos(items) };
}
