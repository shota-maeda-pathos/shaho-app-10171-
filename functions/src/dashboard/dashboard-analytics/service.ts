import { db } from '../../config';
import { AuthContext } from '../../middleware/auth';
import { mapConcurrent } from '../../utils/parallel';
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
  const base = `companies/${auth.companyId}`;
  const monthKeys = generateMonthKeys(input.months);

  const empSnap = await db.collection(`${base}/employees`)
    .where('deletedAt', '==', null)
    .select('officeId', 'lastName', 'firstName')
    .get();

  const employees = empSnap.docs.filter(doc =>
    auth.roles.includes('admin') || auth.officeIds.includes(doc.data().officeId),
  );

  const trends: MonthlyTrend[] = await mapConcurrent(monthKeys, 4, async (ym) => {
    let totalEmployee = 0;
    let totalEmployer = 0;
    let healthTotal = 0;
    let pensionTotal = 0;
    let count = 0;

    await mapConcurrent(employees, 8, async (empDoc) => {
      const insSnap = await db.doc(`${base}/employees/${empDoc.id}/monthlyInsurance/${ym}`).get();
      if (!insSnap.exists) return;
      const ins = insSnap.data()!;
      totalEmployee += ins.totalEmployeeAmount ?? 0;
      totalEmployer += ins.totalEmployerAmount ?? 0;
      healthTotal += (ins.healthInsurance?.employeeAmount ?? 0) + (ins.healthInsurance?.employerAmount ?? 0);
      pensionTotal += (ins.pensionInsurance?.employeeAmount ?? 0) + (ins.pensionInsurance?.employerAmount ?? 0);
      count++;
    });

    return { yearMonth: ym, totalEmployee, totalEmployer, healthTotal, pensionTotal, employeeCount: count };
  });

  // Filing stats
  const filingStats: FilingStats = { total: 0, draft: 0, pending: 0, approved: 0, submitted: 0, accepted: 0 };
  const recentFilings: DashboardAnalyticsResponse['recentFilings'] = [];

  await mapConcurrent(employees, 8, async (empDoc) => {
    const filingsSnap = await db.collection(`${base}/employees/${empDoc.id}/filings`)
      .orderBy('createdAt', 'desc').limit(10).get();

    for (const fDoc of filingsSnap.docs) {
      const f = fDoc.data();
      filingStats.total++;
      if (f.workflowStatus === 'draft') filingStats.draft++;
      if (f.workflowStatus === 'pending') filingStats.pending++;
      if (f.workflowStatus === 'approved') filingStats.approved++;
      if (f.submissionStatus === 'submitted') filingStats.submitted++;
      if (f.submissionStatus === 'accepted') filingStats.accepted++;

      if (recentFilings.length < 10) {
        const emp = empDoc.data();
        recentFilings.push({
          id: fDoc.id,
          employeeId: empDoc.id,
          employeeName: `${emp.lastName} ${emp.firstName}`,
          filingType: f.filingType,
          status: f.submissionStatus !== 'notSubmitted' ? f.submissionStatus : f.workflowStatus,
          effectiveDate: f.effectiveDate,
        });
      }
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

  return { insuranceTrends: trends, filingStats, recentFilings, monthOverMonth, forecast };
}
