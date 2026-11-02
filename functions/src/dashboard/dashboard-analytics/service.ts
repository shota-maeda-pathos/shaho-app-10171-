import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { mapConcurrent } from '../../utils/parallel';
import { getAllChunked } from '../../monthly/service';
import { DashboardAnalyticsInput } from './schema';

interface MonthlyTrend {
  yearMonth: string;
  totalEmployee: number;
  totalEmployer: number;
  healthTotal: number;
  pensionTotal: number;
  employeeCount: number;
}

interface FilingStats {
  total: number;
  draft: number;
  pending: number;
  approved: number;
  submitted: number;
  accepted: number;
}

interface Forecast {
  nextMonth: string;
  estimatedTotal: number;
  estimatedEmployee: number;
  estimatedEmployer: number;
  basis: 'trend' | 'latest';
}

export interface DashboardAnalyticsResponse {
  insuranceTrends: MonthlyTrend[];
  filingStats: FilingStats;
  recentFilings: { id: string; employeeId: string; employeeName: string; filingType: string; status: string; effectiveDate: string }[];
  monthOverMonth: {
    currentMonth: string;
    previousMonth: string;
    currentTotal: number;
    previousTotal: number;
    changePercent: number | null;
  } | null;
  forecast: Forecast | null;
}

function generateMonthKeys(count: number): string[] {
  const months: string[] = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

export async function getDashboardAnalytics(
  input: DashboardAnalyticsInput,
  auth: AuthContext,
): Promise<DashboardAnalyticsResponse> {
  if (input.officeId) requireOffice(auth, input.officeId);
  const base = `companies/${auth.companyId}`;
  const monthKeys = generateMonthKeys(input.months);

  const empSnap = await db.collection(`${base}/employees`)
    .where('deletedAt', '==', null)
    .select('officeId', 'lastName', 'firstName')
    .get();

  const employees = empSnap.docs.filter(doc =>
    (!input.officeId || doc.data().officeId === input.officeId) && (auth.roles.includes('admin') || auth.officeIds.includes(doc.data().officeId)),
  );

  // 月ごとに全員分の保険料をまとめて読む（1人ずつ読むと300人×6か月で20秒ほどかかっていた）
  const trends: MonthlyTrend[] = await mapConcurrent(monthKeys, 3, async (ym) => {
    let totalEmployee = 0;
    let totalEmployer = 0;
    let healthTotal = 0;
    let pensionTotal = 0;
    let count = 0;

    const snaps = await getAllChunked(employees.map(empDoc => db.doc(`${base}/employees/${empDoc.id}/monthlyInsurance/${ym}`)));
    for (const insSnap of snaps) {
      if (!insSnap.exists) continue;
      const ins = insSnap.data()!;
      if (ins.isConfirmed !== true) continue;
      totalEmployee += ins.totalEmployeeAmount ?? 0;
      totalEmployer += ins.totalEmployerAmount ?? 0;
      healthTotal += (ins.healthInsurance?.employeeAmount ?? 0) + (ins.healthInsurance?.employerAmount ?? 0);
      pensionTotal += (ins.pensionInsurance?.employeeAmount ?? 0) + (ins.pensionInsurance?.employerAmount ?? 0);
      count++;
    }

    return { yearMonth: ym, totalEmployee, totalEmployer, healthTotal, pensionTotal, employeeCount: count };
  });

  // Filing stats（1人1回だけ読んで数える。届出のない人がほとんどなので、状態ごとに数を問い合わせるより速い）
  const filingStats: FilingStats = { total: 0, draft: 0, pending: 0, approved: 0, submitted: 0, accepted: 0 };
  const recentFilings: DashboardAnalyticsResponse['recentFilings'] = [];

  await mapConcurrent(employees, 32, async (empDoc) => {
    const filingsSnap = await db.collection(`${base}/employees/${empDoc.id}/filings`)
      .select('filingType', 'workflowStatus', 'submissionStatus', 'effectiveDate', 'createdAt').get();
    const emp = empDoc.data();
    for (const fDoc of filingsSnap.docs) {
      const f = fDoc.data();
      filingStats.total++;
      if (f.workflowStatus === 'draft') filingStats.draft++;
      if (f.workflowStatus === 'pending') filingStats.pending++;
      if (f.workflowStatus === 'approved') filingStats.approved++;
      if (f.submissionStatus === 'submitted') filingStats.submitted++;
      if (f.submissionStatus === 'accepted') filingStats.accepted++;
      recentFilings.push({
        id: fDoc.id,
        employeeId: empDoc.id,
        employeeName: `${emp.lastName} ${emp.firstName}`,
        filingType: f.filingType,
        status: f.submissionStatus !== 'notSubmitted' ? f.submissionStatus : f.workflowStatus,
        effectiveDate: f.effectiveDate,
      });
    }
  });

  // Month over month
  let monthOverMonth: DashboardAnalyticsResponse['monthOverMonth'] = null;
  if (trends.length >= 2) {
    const current = trends[trends.length - 1];
    const previous = trends[trends.length - 2];
    const currentTotal = current.totalEmployee + current.totalEmployer;
    const previousTotal = previous.totalEmployee + previous.totalEmployer;
    monthOverMonth = {
      currentMonth: current.yearMonth,
      previousMonth: previous.yearMonth,
      currentTotal,
      previousTotal,
      changePercent: previousTotal > 0
        ? Math.round(((currentTotal - previousTotal) / previousTotal) * 1000) / 10
        : null,
    };
  }

  let forecast: Forecast | null = null;
  if (trends.length >= 2) {
    const last = trends[trends.length - 1];
    const prev = trends[trends.length - 2];
    const lastTotal = last.totalEmployee + last.totalEmployer;
    const prevTotal = prev.totalEmployee + prev.totalEmployer;
    const nextDate = new Date(Number(last.yearMonth.split('-')[0]), Number(last.yearMonth.split('-')[1]), 1);
    const nextMonth = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}`;

    if (prevTotal > 0 && lastTotal > 0) {
      const growthRate = lastTotal / prevTotal;
      const estimated = Math.round(lastTotal * growthRate);
      forecast = {
        nextMonth,
        estimatedTotal: estimated,
        estimatedEmployee: Math.round(last.totalEmployee * growthRate),
        estimatedEmployer: Math.round(last.totalEmployer * growthRate),
        basis: 'trend',
      };
    } else if (lastTotal > 0) {
      forecast = {
        nextMonth,
        estimatedTotal: lastTotal,
        estimatedEmployee: last.totalEmployee,
        estimatedEmployer: last.totalEmployer,
        basis: 'latest',
      };
    }
  }

  recentFilings.sort((a,b)=>String(b.effectiveDate??'').localeCompare(String(a.effectiveDate??'')));
  return { insuranceTrends: trends, filingStats, recentFilings:recentFilings.slice(0,10), monthOverMonth, forecast };
}
