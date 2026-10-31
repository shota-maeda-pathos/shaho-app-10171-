import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { mapConcurrent } from '../../utils/parallel';
import { MonthRecord, annualCost, breakdown, changeFactors, fiscalMonths, gradeHistogram } from './rules';

const amt = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const pair = (b: { employeeAmount?: number; employerAmount?: number } | null | undefined) => ({ employee: amt(b?.employeeAmount), employer: amt(b?.employerAmount) });

function toRecord(employeeId: string, d: FirebaseFirestore.DocumentData): MonthRecord {
  const cs = pair(d.childSupportContribution), cp = pair(d.childSupportPayment);
  return {
    employeeId, yearMonth: d.yearMonth, healthGrade: d.healthGradeNumber, pensionGrade: d.pensionGradeNumber,
    health: pair(d.healthInsurance), care: pair(d.longTermCareInsurance), pension: pair(d.pensionInsurance),
    childSupport: { employee: cs.employee + cp.employee, employer: cs.employer + cp.employer },
    totalEmployee: amt(d.totalEmployeeAmount), totalEmployer: amt(d.totalEmployerAmount), isExempted: d.isExempted === true,
  };
}

/**
 * 保険料の分析（カタログ12章）：内訳・前月比の要因・部署別・等級分布・年度の実績と見込み（前年度と比べる）。
 * 確定した保険料だけを使う
 */
export async function getCostAnalysis(auth: AuthContext, fiscalYear: number, officeId?: string) {
  if (officeId) requireOffice(auth, officeId);
  const base = `companies/${auth.companyId}`;
  const [empSnap, deptSnap] = await Promise.all([
    db.collection(`${base}/employees`).where('deletedAt', '==', null).select('officeId', 'departmentId').get(),
    db.collection(`${base}/departments`).get(),
  ]);
  const employees = empSnap.docs.filter(e => (!officeId || e.data().officeId === officeId) && (auth.roles.includes('admin') || auth.officeIds.includes(e.data().officeId)));
  const deptName = new Map(deptSnap.docs.map(d => [d.id, d.data().name as string]));
  const deptOf = new Map(employees.map(e => [e.id, e.data().departmentId as string | null]));
  const months = fiscalMonths(fiscalYear), prevMonths = fiscalMonths(fiscalYear - 1);
  const from = prevMonths[0], to = months[11];

  const records: MonthRecord[] = [];
  let bonusThis = 0, bonusPrev = 0;
  await mapConcurrent(employees, 10, async e => {
    const [ins, bonus] = await Promise.all([
      db.collection(`${e.ref.path}/monthlyInsurance`).where('yearMonth', '>=', from).get(),
      db.collection(`${e.ref.path}/bonusInsurance`).where('yearMonth', '>=', from).get(),
    ]);
    for (const d of ins.docs) if (d.data().isConfirmed === true && d.data().yearMonth <= to) records.push(toRecord(e.id, d.data()));
    for (const d of bonus.docs) {
      const x = d.data();
      if (x.isConfirmed !== true) continue;
      if (months.includes(x.yearMonth)) bonusThis += amt(x.totalEmployerAmount);
      else if (prevMonths.includes(x.yearMonth)) bonusPrev += amt(x.totalEmployerAmount);
    }
  });

  const group = (ms: string[]) => {
    const m = new Map<string, MonthRecord[]>();
    for (const r of records) if (ms.includes(r.yearMonth)) m.set(r.yearMonth, [...(m.get(r.yearMonth) ?? []), r]);
    return m;
  };
  const thisYear = group(months), lastYear = group(prevMonths);
  const employerOf = (m: Map<string, MonthRecord[]>) => new Map([...m.entries()].map(([k, rs]) => [k, rs.reduce((a, r) => a + r.totalEmployer, 0)]));
  const latestMonth = [...thisYear.keys()].sort().at(-1) ?? null;
  const latest = latestMonth ? thisYear.get(latestMonth)! : [];
  const prevKey = latestMonth ? [...new Set(records.map(r => r.yearMonth))].filter(m => m < latestMonth).sort().at(-1) ?? null : null;
  const previous = prevKey ? records.filter(r => r.yearMonth === prevKey) : [];

  const departments = new Map<string, { employee: number; employer: number; people: number }>();
  for (const r of latest) {
    const name = deptName.get(deptOf.get(r.employeeId) ?? '') ?? '部署なし';
    const cur = departments.get(name) ?? { employee: 0, employer: 0, people: 0 };
    departments.set(name, { employee: cur.employee + r.totalEmployee, employer: cur.employer + r.totalEmployer, people: cur.people + 1 });
  }

  return {
    fiscalYear,
    latestMonth,
    previousMonth: prevKey,
    monthly: months.map(m => {
      const rs = thisYear.get(m) ?? [];
      return { yearMonth: m, employee: rs.reduce((a, r) => a + r.totalEmployee, 0), employer: rs.reduce((a, r) => a + r.totalEmployer, 0), people: rs.length };
    }),
    breakdown: breakdown(latest),
    changeFactors: latest.length || previous.length ? changeFactors(previous, latest) : null,
    departments: [...departments.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.employer - a.employer),
    gradeHistogram: gradeHistogram(latest),
    annual: annualCost(months, employerOf(thisYear), bonusThis),
    previousAnnual: annualCost(prevMonths, employerOf(lastYear), bonusPrev),
  };
}
