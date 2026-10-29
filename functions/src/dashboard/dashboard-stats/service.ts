import { Timestamp } from 'firebase-admin/firestore';
import { mapConcurrent } from '../../utils/parallel';
import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';

export interface FilingAlert {
  employeeId: string;
  employeeName: string;
  filingType: string;
  filingId: string;
  createdAt: string;
  daysElapsed: number;
}

export interface UncollectedAlert {
  yearMonth: string;
  employeeId: string;
  employeeName: string;
  totalAmount: number;
}

export interface DashboardStatsResponse {
  employeeCount: number;
  pendingApprovals: number;
  pendingFilings: number;
  activeLeaves: number;
  activeExemptions: number;
  alerts: {
    filingDeadlines: FilingAlert[];
    uncollectedPremiums: UncollectedAlert[];
    revisionCandidates: number;
  };
}

function currentYearMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function prevYearMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export async function getDashboardStats(
  auth: AuthContext,
  officeId?: string,
): Promise<DashboardStatsResponse> {
  if (officeId) requireOffice(auth, officeId);
  const base = `companies/${auth.companyId}`;

  const empDocs = await db
    .collection(`${base}/employees`)
    .where('deletedAt', '==', null)
    .select('officeId', 'isActive', 'lastName', 'firstName')
    .get();
  const employees = empDocs.docs.filter((doc) =>
    (!officeId || doc.data().officeId === officeId) && (auth.roles.includes('admin') || auth.officeIds.includes(doc.data().officeId)),
  );
  const employeeCount = employees.filter((doc) => doc.data().isActive === true).length;
  const empIds = employees.map((doc) => doc.id);
  const empNameMap = new Map(employees.map(doc => {
    const d = doc.data();
    return [doc.id, `${d.lastName} ${d.firstName}`];
  }));

  const metrics = [
    ['pendingApprovals', 'approvalRequests', 'status', 'pending'],
    ['pendingFilings', 'filings', 'submissionStatus', 'notSubmitted'],
    ['activeLeaves', 'leaves', 'status', 'active'],
    ['activeExemptions', 'premiumExemptions', 'status', 'active'],
  ] as const;
  const jobs = empIds.flatMap(employeeId => metrics.map(metric => ({ employeeId, metric })));
  const counts = await mapConcurrent(jobs, 12, async ({ employeeId, metric }) => {
    const [key, collection, field, value] = metric;
    const snapshot = await db.collection(`${base}/employees/${employeeId}/${collection}`).where(field, '==', value).count().get();
    return { key, count: snapshot.data().count };
  });

  const result: DashboardStatsResponse = {
    employeeCount, pendingApprovals: 0, pendingFilings: 0, activeLeaves: 0, activeExemptions: 0,
    alerts: { filingDeadlines: [], uncollectedPremiums: [], revisionCandidates: 0 },
  };
  for (const { key, count } of counts) (result as any)[key] += count;

  const now = Timestamp.now();
  const nowMs = now.toMillis();

  // 未提出届出アラート: 作成から14日以上経過した未提出届出
  const filingAlerts: FilingAlert[] = [];
  await mapConcurrent(empIds, 8, async (employeeId) => {
    const snap = await db.collection(`${base}/employees/${employeeId}/filings`)
      .where('submissionStatus', '==', 'notSubmitted')
      .orderBy('createdAt', 'asc')
      .limit(5)
      .get();
    for (const doc of snap.docs) {
      const data = doc.data();
      const createdAt = data.createdAt as Timestamp;
      const daysElapsed = Math.floor((nowMs - createdAt.toMillis()) / (1000 * 60 * 60 * 24));
      if (daysElapsed >= 7) {
        filingAlerts.push({
          employeeId, employeeName: empNameMap.get(employeeId) ?? '',
          filingType: data.filingType, filingId: doc.id,
          createdAt: createdAt.toDate().toISOString().slice(0, 10),
          daysElapsed,
        });
      }
    }
  });
  filingAlerts.sort((a, b) => b.daysElapsed - a.daysElapsed);
  result.alerts.filingDeadlines = filingAlerts.slice(0, 10);

  // 未徴収保険料アラート: 当月・前月に保険料算出済みだが徴収レコードがない
  const ym = currentYearMonth();
  const prevYm = prevYearMonth(ym);
  const uncollected: UncollectedAlert[] = [];
  await mapConcurrent(empIds, 8, async (employeeId) => {
    for (const checkYm of [prevYm, ym]) {
      const insSnap = await db.doc(`${base}/employees/${employeeId}/monthlyInsurance/${checkYm}`).get();
      if (!insSnap.exists) continue;
      const ins = insSnap.data()!;
      if (ins.isConfirmed !== true || ins.isExempted === true) continue;
      const total = ins.totalEmployeeAmount ?? 0;
      if (total <= 0) continue;
      const receipt = await db.doc(`${base}/employees/${employeeId}/collectionReceipts/${checkYm}`).get();
      const collected = receipt.data()?.collectedAmount ?? 0;
      if (collected < total) {
        uncollected.push({
          yearMonth: checkYm, employeeId,
          employeeName: empNameMap.get(employeeId) ?? '',
          totalAmount: total - collected,
        });
      }
    }
  });
  uncollected.sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
  result.alerts.uncollectedPremiums = uncollected.slice(0, 10);

  // 随時改定候補者: 給与のrevisionFlag
  let revisionCount = 0;
  await mapConcurrent(empIds, 8, async (employeeId) => {
    const salSnap = await db.collection(`${base}/employees/${employeeId}/salaries`)
      .where('revisionFlag', '==', true)
      .limit(1)
      .get();
    if (!salSnap.empty) revisionCount++;
  });
  result.alerts.revisionCandidates = revisionCount;

  return result;
}
