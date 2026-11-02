import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext } from '../../middleware/auth';
import { toDateString } from '../../utils/employment';
import { mapConcurrent } from '../../utils/parallel';
import { SUMMARY_CARDS, SummaryCounts, SummaryKey, ageReachedIn, emptyCounts, nextMonth, within } from './rules';

/**
 * サマリーカードの数字を事業所ごとに数えて companies/{c}/dashboard/summary に保存する。
 * ホームは保存した数字を読むだけにする（開くたびに数えると遅いため。docs/stage9-plan.md の#4）
 */
export async function computeSummary(companyId: string): Promise<{ computedAt: string; offices: Record<string, SummaryCounts> }> {
  const base = `companies/${companyId}`;
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const ym = today.slice(0, 7);
  const [offices, employees, filings, approvals, requests] = await Promise.all([
    db.collection(`${base}/offices`).where('isActive', '==', true).get(),
    db.collection(`${base}/employees`).where('deletedAt', '==', null).get(),
    db.collection(`${base}/filingIndex`).where('open', '==', true).get(),
    db.collection(`${base}/approvalIndex`).where('status', '==', 'pending').select('officeId').get(),
    db.collection(`${base}/portalRequests`).where('status', '==', 'submitted').select('officeId').get(),
  ]);
  const counts: Record<string, SummaryCounts> = Object.fromEntries(offices.docs.map(o => [o.id, emptyCounts()]));
  const add = (officeId: string | undefined, key: SummaryKey) => { if (officeId && counts[officeId]) counts[officeId][key] += 1; };

  const weekEnd = new Date(`${today}T00:00:00Z`);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);
  for (const d of filings.docs) {
    const f = d.data();
    if (f.deadline && f.deadline < today) add(f.officeId, 'overdueFilings');
    else if (within(f.deadline, today, 7)) add(f.officeId, 'dueThisWeek');
    if (f.status === 'rejected' || f.status === 'returned') add(f.officeId, 'rejectedOrReturned');
  }
  for (const d of approvals.docs) add(d.data().officeId, 'pendingApprovals');
  for (const d of requests.docs) add(d.data().officeId, 'portalRequests');

  const active = employees.docs.filter(e => e.data().isActive === true && counts[e.data().officeId]);
  const confirmed = new Map<string, number>();
  const month = nextMonth(ym);
  await mapConcurrent(active, 10, async e => {
    const x = e.data();
    const path = e.ref.path;
    const [salary, insurance, revision, leaves] = await Promise.all([
      db.doc(`${path}/salaries/${ym}`).get(),
      db.doc(`${path}/monthlyInsurance/${ym}`).get(),
      db.collection(`${path}/salaries`).where('revisionFlag', '==', true).limit(1).get(),
      db.collection(`${path}/leaves`).get(),
    ]);
    if (!salary.exists) add(x.officeId, 'missingSalaries');
    if (insurance.data()?.isConfirmed === true) confirmed.set(x.officeId, (confirmed.get(x.officeId) ?? 0) + 1);
    if (!revision.empty) add(x.officeId, 'revisionCandidates');
    const birth = toDateString(x.birthDate);
    if (birth && ageReachedIn(birth, month) !== null) add(x.officeId, 'ageEvents');
    if (x.contract?.type === 'fixed' && within(x.contract.endDate, today, 30)) add(x.officeId, 'contractsEnding');
    const soon = leaves.docs.some(l => {
      const v = l.data();
      if (v.leaveType !== 'maternity' && v.leaveType !== 'childcare') return false;
      return within(v.actualStartDate ?? v.expectedStartDate, today, 30) || within(v.actualEndDate ?? v.expectedEndDate, today, 30);
    });
    if (soon) add(x.officeId, 'leavesSoon');
  });
  for (const o of offices.docs) {
    const people = active.filter(e => e.data().officeId === o.id).length;
    if (people > 0 && (confirmed.get(o.id) ?? 0) < people) counts[o.id].unconfirmedOffices = 1;
  }
  const computedAt = Timestamp.now();
  await db.doc(`${base}/dashboard/summary`).set({ offices: counts, computedAt, month: ym });
  return { computedAt: computedAt.toDate().toISOString(), offices: counts };
}

/**
 * 承認・届出・本人からの申請が動いたら、保存した数字を古いしるしにする（トリガーから呼ぶ）。
 * 次にホームを開いた人のところで数え直す。印を付けられなくても元の処理は止めない
 */
export async function markSummaryStale(companyId: string): Promise<void> {
  try {
    await db.doc(`companies/${companyId}/dashboard/summary`).set({ staleAt: Timestamp.now() }, { merge: true });
  } catch { /* 毎朝6時と「数え直す」で追いつく */ }
}

/** 数えたあとに動きがあったか、数えたのが今日（東京）より前なら古い */
function isStale(data: FirebaseFirestore.DocumentData | undefined, today: string): boolean {
  const computedAt: Timestamp | undefined = data?.computedAt;
  if (!computedAt) return false;
  const staleAt: Timestamp | undefined = data?.staleAt;
  if (staleAt && staleAt.toMillis() > computedAt.toMillis()) return true;
  return computedAt.toDate().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }) < today;
}

export interface SummaryCard { key: SummaryKey; label: string; link: string; urgent: boolean; count: number }

/** 保存した数字を、見る人の事業所の範囲（と選んだ事業所）で合計する */
export async function readSummary(auth: AuthContext, officeId?: string): Promise<{ computedAt: string | null; stale: boolean; cards: SummaryCard[] }> {
  const snap = await db.doc(`companies/${auth.companyId}/dashboard/summary`).get();
  const offices = (snap.data()?.offices ?? {}) as Record<string, SummaryCounts>;
  const total = Object.fromEntries(Object.keys(SUMMARY_CARDS).map(k => [k, 0])) as SummaryCounts;
  for (const [id, c] of Object.entries(offices)) {
    if (officeId && id !== officeId) continue;
    if (!auth.roles.includes('admin') && !auth.officeIds.includes(id)) continue;
    for (const k of Object.keys(total) as SummaryKey[]) total[k] += c[k] ?? 0;
  }
  return {
    computedAt: snap.data()?.computedAt?.toDate?.().toISOString() ?? null,
    stale: isStale(snap.data(), new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })),
    cards: (Object.keys(SUMMARY_CARDS) as SummaryKey[]).map(key => ({ key, ...SUMMARY_CARDS[key], count: total[key] })),
  };
}
