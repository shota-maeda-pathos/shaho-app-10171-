import { FieldPath, Timestamp } from 'firebase-admin/firestore';
import { db } from '../config';
import { AuthContext, requireOffice } from '../middleware/auth';
import { OfficeDoc, ProcedureDoc, ProcedureStep } from '../types/firestore';
import { addMonths, lastDayOfMonth } from '../insurance/calculator';
import { acquisitionFilingDeadline, currentWizardStep } from '../onboarding/service';
import { monthlyOverview, runId } from '../monthly/service';
import { currentResignationStep } from '../resignation/service';
import { currentDependentStep } from '../dependent-change/service';
import { currentLeaveStep } from '../leave-procedure/service';
import { currentRevisionStep } from '../grade-revision/service';
import { FILING_LABEL as REVISION_FILING_LABEL, KIND_LABEL as REVISION_KIND_LABEL } from '../grade-revision/rules';
import { currentAgeStep } from '../age-event/service';
import { currentChangeStep } from '../employment-change/service';
import { currentTransferStep } from '../transfer/service';
import { deadlineOf, FILING_LABEL as AGE_FILING_LABEL, KIND_LABEL as AGE_KIND_LABEL, milestonesBetween } from '../age-event/rules';
import { FILING_LABEL } from '../leave-procedure/rules';
import { mapConcurrent } from '../utils/parallel';
import { HomeTodo, TodoTone, forApprover, payDateOf, sortTodos } from './rules';
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
    if (approval?.status === 'cancelled') {
      return { ...base, next: '資格取得届の承認を依頼し直す', detail: approval.cancelReason ? `承認の取消の理由：${approval.cancelReason}` : null, tone: 'action', deadline };
    }
    if (approval?.status === 'rejected') {
      return { ...base, next: '差し戻された資格取得届を直す', detail: approval.comment ? `理由：${approval.comment}` : null, tone: 'action', deadline };
    }
    const tone = approvalTone(auth, approval?.requestedBy);
    return { ...base, next: tone === 'yours' ? '資格取得届を承認する' : '承認者の確認を待っています', detail: null, tone, approve: tone === 'yours', deadline };
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
    if (approval?.status === 'cancelled') {
      return { ...o.base, next: `${o.filingName}の承認を依頼し直す`, detail: approval.cancelReason ? `承認の取消の理由：${approval.cancelReason}` : null, tone: 'action', deadline };
    }
    if (approval?.status === 'rejected') {
      return { ...o.base, next: `差し戻された${o.filingName}を直す`, detail: approval.comment ? `理由：${approval.comment}` : null, tone: 'action', deadline };
    }
    const tone = approvalTone(auth, approval?.requestedBy);
    return { ...o.base, next: tone === 'yours' ? `${o.filingName}を承認する` : '承認者の確認を待っています', detail: o.detail, tone, approve: tone === 'yours', deadline };
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

const REVISION_NEXT: Record<string, string> = {
  change: '変動を確かめる',
  judge: '判定して改定するか決める',
  filing: '届出を作って承認を依頼する',
  submit: '届出を提出する',
  confirm: '完了を確認する',
};

/** 随時改定・終了時改定。判定に要る給与がそろうまでは「待ち」にする */
function revisionTodo(p: ProcedureDoc & { id: string }, auth: AuthContext, officeName: string) {
  const gr = p.gradeRevision!;
  const step = currentRevisionStep(p);
  const base = {
    id: `procedure-${p.id}`, kind: 'revision' as const, title: `${p.employeeName}さんの${REVISION_KIND_LABEL[gr.kind]}`, officeName,
    route: `/revisions/${p.id}`, queryParams: { officeId: p.officeId }, updatedAt: iso(p.updatedAt),
  };
  const ymText = (m: string) => `${Number(m.slice(0, 4))}年${Number(m.slice(5, 7))}月`;
  const detail = gr.startMonth ? `${ymText(gr.startMonth)}〜${ymText(addMonths(gr.startMonth, 2))}の給与で判定` : null;
  // 3か月目の給与がまだ来ていなければ、判定は待ち
  if (step === 'judge' && gr.startMonth && addMonths(gr.startMonth, 2) > currentMonthJst()) {
    return Promise.resolve<HomeTodo>({ ...base, next: `${ymText(addMonths(gr.startMonth, 2))}支給の給与がそろったら判定する`, detail, tone: 'waiting', deadline: null });
  }
  return wizardTodo(p, auth, { base, step, next: REVISION_NEXT, filingName: REVISION_FILING_LABEL[gr.kind], detail });
}

const AGE_NEXT: Record<string, string> = {
  check: '到達日と届出の要否を確かめる',
  filing: '届出を作って承認を依頼する',
  submit: '届出を提出する',
  confirm: '完了を確認する',
};

/** 年齢到達（70歳・75歳）の手続き */
function ageTodo(p: ProcedureDoc & { id: string }, auth: AuthContext, officeName: string) {
  const ae = p.ageEvent!;
  return wizardTodo(p, auth, {
    base: {
      id: `procedure-${p.id}`, kind: 'age', title: `${p.employeeName}さんの${AGE_KIND_LABEL[ae.kind]}`, officeName,
      route: `/age-events/${p.id}`, queryParams: { officeId: p.officeId }, updatedAt: iso(p.updatedAt),
    },
    step: currentAgeStep(p), next: AGE_NEXT, filingName: AGE_FILING_LABEL[ae.kind], detail: `資格喪失日 ${ae.lossDate}`,
  });
}

const CHANGE_NEXT: Record<string, string> = {
  entry: '新しい雇用条件を入れる',
  filing: '届出を作って承認を依頼する',
  submit: '届出を提出する',
  confirm: '完了を確認する',
};

/** 雇用条件の変更。雇用条件の承認は手続きの状態で追う（届出の承認は wizardTodo） */
async function employmentChangeTodo(p: ProcedureDoc & { id: string }, auth: AuthContext, officeName: string): Promise<HomeTodo | null> {
  const ec = p.employmentChange!;
  const step = currentChangeStep(p);
  const base = {
    id: `procedure-${p.id}`, kind: 'employment' as const, title: `${p.employeeName}さんの${ec.reason === 'renewal' ? '契約の更新' : '雇用条件の変更'}`, officeName,
    route: `/employment-changes/${p.id}`, queryParams: { officeId: p.officeId }, updatedAt: iso(p.updatedAt),
  };
  const detail = ec.effectiveDate ? `${ec.effectiveDate}から` : null;
  if (step === 'change_approval') {
    const a = ec.approvalId && p.employeeId
      ? (await db.doc(`companies/${auth.companyId}/employees/${p.employeeId}/approvalRequests/${ec.approvalId}`).get()).data()
      : undefined;
    if (a?.status === 'rejected') return { ...base, next: '差し戻された雇用条件を直す', detail: a.comment ? `理由：${a.comment}` : detail, tone: 'action', deadline: null };
    if (a?.status === 'approved') return { ...base, next: '承認された雇用条件を台帳に反映する', detail, tone: 'yours', deadline: null };
    const tone = approvalTone(auth, a?.requestedBy);
    return { ...base, next: tone === 'yours' ? '雇用条件を承認する' : '承認者の確認を待っています', detail, tone, approve: tone === 'yours', deadline: null };
  }
  return wizardTodo(p, auth, { base, step, next: CHANGE_NEXT, filingName: ec.effect === 'acquire' ? '資格取得届' : '資格喪失届', detail });
}

const TRANSFER_NEXT: Record<string, string> = {
  entry: '異動先と異動日を入れる',
  apply: '台帳の所属事業所を変える',
  filings: '資格喪失届・資格取得届を承認・提出する',
  confirm: '完了を確認する',
};

/** 事業所間異動。届出は届出の画面で承認・提出する */
function transferTodo(p: ProcedureDoc & { id: string }, officeName: string): HomeTodo | null {
  const step = currentTransferStep(p);
  const next = TRANSFER_NEXT[step];
  if (!next) return null;
  const t = p.transfer!;
  return {
    id: `procedure-${p.id}`, kind: 'transfer', title: `${p.employeeName}さんの事業所間異動`, officeName, next,
    detail: t.transferDate ? `${t.transferDate}に異動${t.filingRequired ? '（届出あり）' : ''}` : null,
    tone: 'yours', deadline: step === 'filings' || step === 'apply' ? date(p.deadline) : null,
    route: `/transfers/${p.id}`, queryParams: { officeId: p.officeId }, updatedAt: iso(p.updatedAt),
  };
}

/**
 * 有期雇用の契約の満了（カタログ：期間満了が近づくと通知し、更新しないなら退職処理へ移る導線を出す）。
 * 先月から来月末までに満了する人。従業員に写した契約（`contract`）だけを見る
 */
function contractTodo(id: string, e: FirebaseFirestore.DocumentData, today: string, officeName: string): HomeTodo | null {
  const c = e.contract as { type?: string; endDate?: string | null; renewalExpected?: boolean } | undefined;
  if (c?.type !== 'fixed' || !c.endDate) return null;
  const thisMonth = today.slice(0, 7);
  if (c.endDate < `${addMonths(thisMonth, -1)}-01` || c.endDate > lastDayOfMonth(addMonths(thisMonth, 1))) return null;
  const md = `${Number(c.endDate.slice(5, 7))}月${Number(c.endDate.slice(8))}日`;
  return {
    id: `contract-${id}`, kind: 'contract', title: `${`${e.lastName ?? ''} ${e.firstName ?? ''}`.trim()}さんの契約満了`, officeName,
    next: '契約を更新するか決める', detail: `${md}に契約期間が満了します${c.renewalExpected ? '（更新の見込みあり）' : ''}。更新しない場合は退職の手続きへ`,
    tone: c.endDate < today ? 'action' : 'yours', deadline: c.endDate,
    route: `/employees/${id}`, queryParams: {}, updatedAt: null,
  };
}

/**
 * まだ手続きを始めていない年齢到達（カタログ：翌月の到達者を事前に表示する）。
 * 40・65歳は届出がないため「待ち」で知らせるだけ。70・75歳は、2か月前から来月末までに起きる人の手続きを促す
 */
async function ageNoticeTodos(auth: AuthContext, inScope: (officeId: string) => boolean, officeName: (id: string) => string): Promise<HomeTodo[]> {
  const base = `companies/${auth.companyId}`;
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const thisMonth = today.slice(0, 7);
  const from = `${addMonths(thisMonth, -2)}-01`;
  const to = lastDayOfMonth(addMonths(thisMonth, 1));
  // 等価条件だけにして複合索引に頼らない。生年月日だけを読む
  const [employees, started] = await Promise.all([
    db.collection(`${base}/employees`).where('isActive', '==', true).where('deletedAt', '==', null)
      .select('birthDate', 'lastName', 'firstName', 'officeId', 'contract').get(),
    db.collection(`${base}/procedures`).where('procedureType', '==', 'age_event').get(),
  ]);
  const done = new Set(started.docs.map(d => d.data() as ProcedureDoc)
    .filter(p => p.ageEvent && p.status !== 'cancelled' && !p.deletedAt).map(p => `${p.employeeId}:${p.ageEvent!.kind}`));
  const todos: HomeTodo[] = [];
  for (const d of employees.docs) {
    const e = d.data();
    if (!inScope(e.officeId)) continue;
    const contract = contractTodo(d.id, e, today, officeName(e.officeId));
    if (contract) todos.push(contract);
    if (!e.birthDate) continue;
    const birth = (e.birthDate as Timestamp).toDate().toISOString().slice(0, 10);
    for (const m of milestonesBetween(birth, from, to)) {
      const name = `${e.lastName ?? ''} ${e.firstName ?? ''}`.trim();
      const common = { officeName: officeName(e.officeId), updatedAt: null, detail: m.effect };
      if (!m.kind) {
        // 40・65歳は今月以降のものだけ（届出はなく、保険料の計算が自動で変わる）
        if (m.eventDate < `${thisMonth}-01`) continue;
        todos.push({
          ...common, id: `age-${d.id}-${m.age}`, kind: 'age', title: `${name}さんの${m.age}歳到達`,
          next: '確かめるだけ（届出はありません）', tone: 'waiting', deadline: m.eventDate,
          route: `/employees/${d.id}`, queryParams: {},
        });
        continue;
      }
      if (done.has(`${d.id}:${m.kind}`)) continue;
      const deadline = deadlineOf(m.eventDate);
      todos.push({
        ...common, id: `age-${d.id}-${m.age}`, kind: 'age', title: `${name}さんの${AGE_KIND_LABEL[m.kind]}`,
        next: `${m.age}歳到達の手続きを始める`, tone: deadline < today ? 'action' : 'yours', deadline,
        route: '/age-events/new', queryParams: { employeeId: d.id, kind: m.kind },
      });
    }
  }
  return todos;
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
    detail: step.statusDetail ?? (p.statusReason || null), tone, approve: step.type === 'approval' && tone === 'yours', deadline: date(p.deadline),
    route: `/procedures/${p.id}`, queryParams: { officeId: p.officeId }, updatedAt: iso(p.updatedAt),
  };
}

async function procedureTodos(auth: AuthContext, inScope: (officeId: string) => boolean, officeName: (id: string) => string) {
  // 等価条件だけにして複合索引に頼らない。旧方式の手続きで件数の上限が埋まらないよう、1000件ずつ最後まで読む
  const query = db.collection(`companies/${auth.companyId}/procedures`).where('status', '==', 'in_progress').where('deletedAt', '==', null);
  const docs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  for (let page = 0; page < 20; page++) {
    let q = query.orderBy(FieldPath.documentId()).limit(1000);
    if (docs.length) q = q.startAfter(docs[docs.length - 1].id);
    const snap = await q.get();
    docs.push(...snap.docs);
    if (snap.size < 1000) break;
  }
  const procs = docs.map(d => ({ id: d.id, ...(d.data() as ProcedureDoc) }))
    .filter(p => inScope(p.officeId) && (!p.targetOfficeId || inScope(p.targetOfficeId)));
  const todos = await mapConcurrent(procs, 10, p => p.onboarding ? onboardingTodo(p, auth, officeName(p.officeId))
    : p.resignation ? resignationTodo(p, auth, officeName(p.officeId))
    : p.dependentChange ? dependentTodo(p, auth, officeName(p.officeId))
    : p.leaveProcedure ? leaveTodo(p, auth, officeName(p.officeId))
    : p.gradeRevision ? revisionTodo(p, auth, officeName(p.officeId))
    : p.ageEvent ? ageTodo(p, auth, officeName(p.officeId))
    : p.employmentChange ? employmentChangeTodo(p, auth, officeName(p.officeId))
    : p.transfer ? Promise.resolve(transferTodo(p, officeName(p.officeId)))
    : Promise.resolve(procedureTodo(p, auth, officeName(p.officeId))));
  return todos.filter((t): t is HomeTodo => t !== null);
}

// ── 毎月の処理・算定基礎届・賞与（まとめて進める手続き） ─────────────────

function monthLabel(ym: string) { const [y, m] = ym.split('-'); return `${y}年${Number(m)}月`; }

/**
 * ホームに出す一括型の手続き（事業所×月）。どれを出すかは軽く決め、次にやることは1件ずつ bulkTodo で計算する。
 * 次にやることは各画面と同じ判定で全員分の状況から決めるため1件に数秒かかる。ホームは1件ずつ別の呼び出しで並べて読む。
 */
export interface BulkTarget {
  kind: 'monthly' | 'santei' | 'bonus';
  officeId: string;
  /** 毎月の処理・賞与は支給月（YYYY-MM）、算定基礎届は年（YYYY） */
  period: string;
}

/** 毎月の処理：当月分は必ず、前後の月は始めていて終わっていないものだけ */
async function monthlyTargets(auth: AuthContext, offices: { id: string; data: OfficeDoc }[]): Promise<BulkTarget[]> {
  if (!offices.length) return [];
  const base = `companies/${auth.companyId}`;
  const current = currentMonthJst();
  const months = [addMonths(current, -1), current, addMonths(current, 1)];
  const runs = await db.getAll(...offices.flatMap(o => months.map(m => db.doc(`${base}/monthlyRuns/${runId(o.id, m)}`))));
  return offices.flatMap((office, i) => months
    .filter((m, j) => m === current || runs[i * months.length + j].data()?.latestJobId)
    .map(period => ({ kind: 'monthly' as const, officeId: office.id, period })));
}

/** 算定基礎届：準備期間（6月1日〜7月10日）は始めていなくても、それ以外は始めた年だけ */
async function santeiTargets(auth: AuthContext, offices: { id: string; data: OfficeDoc }[]): Promise<BulkTarget[]> {
  if (!offices.length) return [];
  const base = `companies/${auth.companyId}`;
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const year = Number(today.slice(0, 4));
  const inPeriod = today >= `${year}-06-01` && today <= `${year}-07-10`;
  const runs = await db.getAll(...offices.map(o => db.doc(`${base}/santeiRuns/${santeiRunId(o.id, year)}`)));
  return offices.filter((_, i) => inPeriod || runs[i].exists).map(o => ({ kind: 'santei' as const, officeId: o.id, period: String(year) }));
}

/** 賞与：始めた支給月（半年以内）と、支給予定月が終わったのに賞与が登録されていない月（3か月以内） */
async function bonusTargets(auth: AuthContext, offices: { id: string; data: OfficeDoc }[]): Promise<BulkTarget[]> {
  if (!offices.length) return [];
  const base = `companies/${auth.companyId}`;
  const current = currentMonthJst();
  return (await mapConcurrent(offices, 4, async office => {
    const runs = await db.collection(`${base}/bonusRuns`).where('officeId', '==', office.id).get();
    const months = new Set(runs.docs.map(d => d.data().payMonth as string).filter(m => m && m >= addMonths(current, -6)));
    for (let i = 1; i <= 3; i++) {
      const m = addMonths(current, -i);
      if (isScheduledMonth(office.data.bonusMonths, m) && !months.has(m)) months.add(m);
    }
    return [...months].map(period => ({ kind: 'bonus' as const, officeId: office.id, period }));
  })).flat();
}

/** 一括型の手続き1件の「次にやること」。終わっていれば null。承認者だけの人には、自分の番のものだけ返す */
export async function bulkTodo(auth: AuthContext, target: BulkTarget): Promise<HomeTodo | null> {
  requireOffice(auth, target.officeId);
  const officeSnap = await db.doc(`companies/${auth.companyId}/offices/${target.officeId}`).get();
  if (!officeSnap.exists) return null;
  const office = { id: officeSnap.id, data: officeSnap.data() as OfficeDoc };
  const todo = target.kind === 'monthly' ? await monthlyTodo(auth, office, target.period)
    : target.kind === 'santei' ? await santeiTodo(auth, office, Number(target.period))
    : await bonusTodo(auth, office, target.period);
  return todo && (isOperator(auth) || forApprover(todo)) ? todo : null;
}

/** 毎月の処理の1件。毎月の処理の画面と同じ判定で全員分の状況から決める（最後の一括処理からの推測はしない） */
async function monthlyTodo(auth: AuthContext, office: { id: string; data: OfficeDoc }, payMonth: string): Promise<HomeTodo | null> {
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
}

/** 算定基礎届の1件。算定基礎届の画面と同じ判定（santei/progress.ts） */
async function santeiTodo(auth: AuthContext, office: { id: string; data: OfficeDoc }, year: number): Promise<HomeTodo | null> {
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
}

/** 賞与の1件。賞与の画面と同じ判定（bonus/progress.ts） */
async function bonusTodo(auth: AuthContext, office: { id: string; data: OfficeDoc }, payMonth: string): Promise<HomeTodo | null> {
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
}

// ── まとめ ───────────────────────────────────────────

/**
 * ホームのやることリスト。進行中の手続き（入社など）は次にやることと期限つきで返す。
 * 毎月の処理・算定基礎届・賞与は、deferBulk のときは対象（bulk）だけ返し、画面が1件ずつ bulkTodo で読む（全部を1回で計算すると20秒かかるため）。
 * 承認者だけの人には、承認を頼まれているものだけを返す。
 */
export async function listHomeTodos(auth: AuthContext, officeId?: string, deferBulk = false) {
  if (officeId) requireOffice(auth, officeId);
  const officeSnap = await db.collection(`companies/${auth.companyId}/offices`).where('isActive', '==', true).get();
  const offices = officeSnap.docs
    .map(d => ({ id: d.id, data: d.data() as OfficeDoc }))
    .filter(o => (!officeId || o.id === officeId) && (auth.roles.includes('admin') || auth.officeIds.includes(o.id)));
  const names = new Map(offices.map(o => [o.id, o.data.name]));
  const inScope = (id: string) => names.has(id);

  const [procedures, ages, monthly, santei, bonus] = await Promise.all([
    procedureTodos(auth, inScope, id => names.get(id) ?? ''),
    ageNoticeTodos(auth, inScope, id => names.get(id) ?? ''),
    monthlyTargets(auth, offices),
    santeiTargets(auth, offices),
    bonusTargets(auth, offices),
  ]);
  const bulk = [...monthly, ...santei, ...bonus];
  let items = [...procedures, ...ages];
  if (!deferBulk) {
    const bulkItems = await mapConcurrent(bulk, 6, t => bulkTodo(auth, t));
    items = [...items, ...bulkItems.filter((t): t is HomeTodo => t !== null)];
  }
  if (!isOperator(auth)) items = items.filter(forApprover);
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  return { today, items: sortTodos(items), bulk: deferBulk ? bulk.map(t => ({ ...t, officeName: names.get(t.officeId) ?? '' })) : [] };
}
