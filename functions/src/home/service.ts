import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../config';
import { AuthContext, requireOffice } from '../middleware/auth';
import { OfficeDoc, ProcedureDoc, ProcedureStep } from '../types/firestore';
import { addMonths } from '../insurance/calculator';
import { acquisitionFilingDeadline, currentWizardStep } from '../onboarding/service';
import { monthlyOverview, runId } from '../monthly/service';
import { currentResignationStep } from '../resignation/service';
import { currentDependentStep } from '../dependent-change/service';
import { currentLeaveStep } from '../leave-procedure/service';
import { FILING_LABEL } from '../leave-procedure/rules';
import { mapConcurrent } from '../utils/parallel';
import { HomeTodo, TodoTone, payDateOf, sortTodos } from './rules';
import { monthlyProgress } from './monthly-progress';
import { santeiOverview, santeiRunId } from '../santei/service';
import { santeiProgress } from '../santei/progress';
import { bonusOverview, bonusRunId } from '../bonus/service';
import { bonusProgress } from '../bonus/progress';
import { isScheduledMonth } from '../bonus/bonus-calc';

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

const RESIGNATION_NEXT: Record<string, string> = {
  entry: '退職日と理由を入れる',
  settlement: '最後の保険料の集め方を決める',
  account: '退職後のアカウントを確かめる',
  filing: '資格喪失届を作って承認を依頼する',
  submit: '資格喪失届を提出する',
  confirm: '完了を確認する',
};

/** 個人型のウィザード（退職・扶養）で共通の出し方。承認待ち・差し戻し・返戻を見て次にやることを出す */
async function wizardTodo(p: ProcedureDoc & { id: string }, auth: AuthContext, o: {
  base: Omit<HomeTodo, 'next' | 'detail' | 'tone' | 'deadline'>; step: string; next: Record<string, string>;
  filingName: string; detail: string | null;
}): Promise<HomeTodo | null> {
  // 届出の期限（提出が済めば関係ない）
  const submitted = p.steps.some(s => (s.id === 'mock_filing' || s.id === 'paper_submit') && s.status === 'completed');
  const deadline = submitted ? null : date(p.deadline);
  if (o.step === 'approval') {
    const refs = p.references.filter(r => r.type === 'approval' && r.stepId === 'approval');
    const approvalId = refs.length ? refs[refs.length - 1].documentId : null;
    const approval = p.employeeId && approvalId
      ? (await db.doc(`companies/${auth.companyId}/employees/${p.employeeId}/approvalRequests/${approvalId}`).get()).data()
      : undefined;
    if (approval?.status === 'rejected') {
      return { ...o.base, next: `差し戻された${o.filingName}を直す`, detail: approval.comment ? `理由：${approval.comment}` : null, tone: 'action', deadline };
    }
    const tone = approvalTone(auth, approval?.requestedBy);
    return { ...o.base, next: tone === 'yours' ? `${o.filingName}を承認する` : '承認者の確認を待っています', detail: o.detail, tone, deadline };
  }
  const returned = p.steps.find(s => s.status === 'returned');
  if (returned) return { ...o.base, next: `返戻された${o.filingName}を直す`, detail: returned.statusDetail, tone: 'action', deadline };
  const next = o.next[o.step];
  return next ? { ...o.base, next, detail: o.detail, tone: 'yours', deadline } : null;
}

function resignationTodo(p: ProcedureDoc & { id: string }, auth: AuthContext, officeName: string) {
  const transfer = p.resignation!.settlement?.totals.transfer ?? 0;
  const step = currentResignationStep(p);
  return wizardTodo(p, auth, {
    base: {
      id: `procedure-${p.id}`, kind: 'resignation', title: `${p.employeeName}さんの退職`, officeName,
      route: `/resignation/${p.id}`, queryParams: { officeId: p.officeId }, updatedAt: iso(p.updatedAt),
    },
    step, next: RESIGNATION_NEXT, filingName: '資格喪失届',
    detail: step !== 'entry' && transfer > 0 ? `別途回収 ${transfer.toLocaleString('ja-JP')}円` : null,
  });
}

const DEPENDENT_NEXT: Record<string, string> = {
  change: '変わった内容を入れる',
  filing: '被扶養者（異動）届を作って承認を依頼する',
  submit: '被扶養者（異動）届を提出する',
  confirm: '完了を確認して台帳に反映する',
};

function dependentTodo(p: ProcedureDoc & { id: string }, auth: AuthContext, officeName: string) {
  const items = p.dependentChange!.items;
  return wizardTodo(p, auth, {
    base: {
      id: `procedure-${p.id}`, kind: 'dependent', title: `${p.employeeName}さんの扶養`, officeName,
      route: `/dependents/${p.id}`, queryParams: { officeId: p.officeId }, updatedAt: iso(p.updatedAt),
    },
    step: currentDependentStep(p), next: DEPENDENT_NEXT, filingName: '被扶養者（異動）届',
    detail: items.length ? items.map(i => `${i.lastName} ${i.firstName}`).join('・') : null,
  });
}

const LEAVE_NEXT: Record<string, string> = {
  plan: '休業の期間を決める',
  filing: '届出を作って承認を依頼する',
  submit: '届出を提出する',
  confirm: '完了を確認する',
};

/** 産休・育休。休業中は「待ち」にして、終了予定日を期限として出す（出産・延長・復帰を記録する） */
async function leaveTodo(p: ProcedureDoc & { id: string }, auth: AuthContext, officeName: string) {
  const lp = p.leaveProcedure!;
  const step = currentLeaveStep(p);
  const short = lp.kind === 'maternity' ? '産休' : '育休';
  const base = {
    id: `procedure-${p.id}`, kind: 'leave' as const, title: `${p.employeeName}さんの${short}`, officeName,
    route: `/leaves/${p.id}`, queryParams: { officeId: p.officeId }, updatedAt: iso(p.updatedAt),
  };
  const md = (d: string) => `${Number(d.slice(5, 7))}月${Number(d.slice(8))}日`;
  const period = lp.period ? `${md(lp.period.startDate)}〜${md(lp.period.actualEndDate ?? lp.period.plannedEnd)}` : null;
  if (step === 'during') {
    const end = lp.period!.plannedEnd;
    const next = lp.kind === 'maternity' && !lp.period!.actualBirthDate ? '出産したら出産日を記録する' : `${short}を終えたら復帰を記録する`;
    return { ...base, next, detail: period, tone: 'waiting' as const, deadline: end };
  }
  return wizardTodo(p, auth, { base, step, next: LEAVE_NEXT, filingName: FILING_LABEL[lp.kind][lp.filingKind], detail: period });
}

/** 入社・退職・扶養以外の手続き（段階6でウィザードに置き換える）。次のステップを出す */
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
  const todos = await mapConcurrent(procs, 10, p => p.onboarding ? onboardingTodo(p, auth, officeName(p.officeId))
    : p.resignation ? resignationTodo(p, auth, officeName(p.officeId))
    : p.dependentChange ? dependentTodo(p, auth, officeName(p.officeId))
    : p.leaveProcedure ? leaveTodo(p, auth, officeName(p.officeId))
    : Promise.resolve(procedureTodo(p, auth, officeName(p.officeId))));
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

// ── 算定基礎届 ───────────────────────────────────────

/**
 * 事業所ごとの今年の算定基礎届。準備期間（6月1日〜7月10日）は始めていなくても出し、それ以外は始めていて終わっていないものだけ出す。
 * 次にやることは、算定基礎届の画面と同じ判定（santei/progress.ts）で全員分の状況から決める
 */
async function santeiTodos(auth: AuthContext, offices: { id: string; data: OfficeDoc }[]) {
  if (!offices.length) return [];
  const base = `companies/${auth.companyId}`;
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const year = Number(today.slice(0, 4));
  const inPeriod = today >= `${year}-06-01` && today <= `${year}-07-10`;
  const runs = await db.getAll(...offices.map(o => db.doc(`${base}/santeiRuns/${santeiRunId(o.id, year)}`)));
  const targets = offices.filter((_, i) => inPeriod || runs[i].exists);
  const todos = await mapConcurrent(targets, 4, async (office): Promise<HomeTodo | null> => {
    const todo = {
      id: `santei-${office.id}-${year}`, kind: 'santei' as const, title: `算定基礎届（${year}年）`,
      officeName: office.data.name, deadline: `${year}-07-10`, route: '/santei', queryParams: { officeId: office.id, year: String(year) },
    };
    let overview: Awaited<ReturnType<typeof santeiOverview>>;
    try {
      overview = await santeiOverview({ companyId: auth.companyId, officeId: office.id, year }, auth);
    } catch (e) {
      return { ...todo, next: '状況を読み込めませんでした', detail: (e as Error).message || null, tone: 'action', updatedAt: null };
    }
    const job = overview.job;
    if (job?.status === 'stalled') return { ...todo, updatedAt: job.createdAt, next: `${job.label}が途中で止まりました`, detail: '算定基礎届の画面で、もう一度実行してください', tone: 'action' };
    if (job?.status === 'running') return { ...todo, updatedAt: job.createdAt, next: `${job.label}を処理しています（${job.processed}/${job.total}名）`, detail: null, tone: 'waiting' };
    const progress = santeiProgress({ rows: overview.rows, filings: overview.filings, canApprove: overview.me.canApprove, uid: auth.uid });
    if (!progress) return null;
    const failed = job && job.failed > 0 ? `直前の${job.label}で${job.failed}名が失敗しました` : null;
    return { ...todo, updatedAt: job?.createdAt ?? null, ...progress, detail: [failed, progress.detail].filter(Boolean).join('／') || null };
  });
  return todos.filter((t): t is HomeTodo => t !== null);
}

// ── 賞与 ─────────────────────────────────────────────

/**
 * 事業所ごとの賞与。始めた支給月（半年以内）のうち終わっていないものと、支給予定月が終わったのに賞与が登録されていない月（3か月以内）を出す。
 * 次にやることは、賞与の画面と同じ判定（bonus/progress.ts）で全員分の状況から決める
 */
async function bonusTodos(auth: AuthContext, offices: { id: string; data: OfficeDoc }[]) {
  if (!offices.length) return [];
  const base = `companies/${auth.companyId}`;
  const current = currentMonthJst();
  const targets = (await mapConcurrent(offices, 4, async office => {
    const runs = await db.collection(`${base}/bonusRuns`).where('officeId', '==', office.id).get();
    const months = new Set(runs.docs.map(d => d.data().payMonth as string).filter(m => m && m >= addMonths(current, -6)));
    for (let i = 1; i <= 3; i++) {
      const m = addMonths(current, -i);
      if (isScheduledMonth(office.data.bonusMonths, m) && !months.has(m)) months.add(m);
    }
    return [...months].map(payMonth => ({ office, payMonth }));
  })).flat();
  const todos = await mapConcurrent(targets, 4, async ({ office, payMonth }): Promise<HomeTodo | null> => {
    const todo = {
      id: `bonus-${bonusRunId(office.id, payMonth)}`, kind: 'bonus' as const, title: `賞与（${payMonth.slice(0, 4)}年${Number(payMonth.slice(5, 7))}月支給）`,
      officeName: office.data.name, route: '/bonus', queryParams: { officeId: office.id, month: payMonth },
    };
    let overview: Awaited<ReturnType<typeof bonusOverview>>;
    try {
      overview = await bonusOverview({ companyId: auth.companyId, officeId: office.id, payMonth }, auth);
    } catch (e) {
      return { ...todo, deadline: null, next: '状況を読み込めませんでした', detail: (e as Error).message || null, tone: 'action', updatedAt: null };
    }
    const deadline = overview.deadline;
    const job = overview.job;
    if (job?.status === 'stalled') return { ...todo, deadline, updatedAt: job.createdAt, next: `${job.label}が途中で止まりました`, detail: '賞与の画面で、もう一度実行してください', tone: 'action' };
    if (job?.status === 'running') return { ...todo, deadline, updatedAt: job.createdAt, next: `${job.label}を処理しています（${job.processed}/${job.total}名）`, detail: null, tone: 'waiting' };
    const progress = bonusProgress({
      rows: overview.rows, filings: overview.filings, canApprove: overview.me.canApprove, uid: auth.uid, reviews: overview.reviews,
      scheduled: overview.scheduled, monthEnded: overview.monthEnded, nonPayment: overview.nonPayment,
    });
    if (!progress) return null;
    const failed = job && job.failed > 0 ? `直前の${job.label}で${job.failed}名が失敗しました` : null;
    return { ...todo, deadline, updatedAt: job?.createdAt ?? null, ...progress, detail: [failed, progress.detail].filter(Boolean).join('／') || null };
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

  const [procedures, monthly, santei, bonus] = await Promise.all([
    procedureTodos(auth, inScope, id => names.get(id) ?? ''),
    monthlyTodos(auth, offices),
    santeiTodos(auth, offices),
    bonusTodos(auth, offices),
  ]);
  let items = [...procedures, ...monthly, ...santei, ...bonus];
  if (!isOperator(auth)) items = items.filter(t => t.tone === 'yours');
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  return { today, items: sortTodos(items) };
}
