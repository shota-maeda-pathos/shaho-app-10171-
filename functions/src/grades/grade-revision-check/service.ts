import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { EmployeeDoc, SalaryDoc, GradeDoc, EmploymentDoc, GradeTableEntry } from '../../types/firestore';
import { notFound } from '../../utils/errors';
import { findApplicableRate } from '../../utils/insurance-rate';
import { GradeRevisionCheckInput } from './schema';

function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

function lookupGrade(table: GradeTableEntry[], amount: number): GradeTableEntry | null {
  for (const entry of table) {
    if (amount >= entry.lowerBound && amount <= entry.upperBound) {
      return entry;
    }
  }
  if (table.length > 0 && amount > table[table.length - 1].upperBound) {
    return table[table.length - 1];
  }
  if (table.length > 0 && amount < table[0].lowerBound) {
    return table[0];
  }
  return null;
}

export interface RevisionCheckResult {
  eligible: boolean;
  employeeId: string;
  employeeName: string;
  changeMonth: string;
  months: { yearMonth: string; totalSalary: number; paymentBasisDays: number }[];
  averageSalary: number | null;
  currentHealthGrade: number | null;
  currentPensionGrade: number | null;
  currentHealthStandardRemuneration: number | null;
  currentPensionStandardRemuneration: number | null;
  newHealthGrade: number | null;
  newPensionGrade: number | null;
  newHealthStandardRemuneration: number | null;
  newPensionStandardRemuneration: number | null;
  healthGradeDiff: number | null;
  pensionGradeDiff: number | null;
  effectiveMonth: string | null;
  reasons: string[];
  failReasons: string[];
}

export async function checkGradeRevision(
  input: GradeRevisionCheckInput,
  auth: AuthContext,
): Promise<RevisionCheckResult> {
  const companyId = auth.companyId;
  const empRef = db.doc(`companies/${companyId}/employees/${input.employeeId}`);
  const empSnap = await empRef.get();
  if (!empSnap.exists || empSnap.data()!.deletedAt !== null) {
    throw notFound('従業員');
  }
  const emp = empSnap.data()! as EmployeeDoc;

  if (!auth.roles.includes('admin')) {
    requireOffice(auth, emp.officeId);
  }

  const employeeName = `${emp.lastName} ${emp.firstName}`;
  const failReasons: string[] = [];

  const month1 = input.changeMonth;
  const month2 = addMonths(month1, 1);
  const month3 = addMonths(month1, 2);
  const targetMonths = [month1, month2, month3];

  const salarySnaps = await Promise.all(
    targetMonths.map(ym =>
      db.doc(`companies/${companyId}/employees/${input.employeeId}/salaries/${ym}`).get()
    )
  );

  const months: { yearMonth: string; totalSalary: number; paymentBasisDays: number }[] = [];
  let allConfirmed = true;
  for (let i = 0; i < 3; i++) {
    if (!salarySnaps[i].exists) {
      failReasons.push(`${targetMonths[i]}の給与データがありません`);
      allConfirmed = false;
      continue;
    }
    const sal = salarySnaps[i].data()! as SalaryDoc;
    if (!sal.isConfirmed) {
      failReasons.push(`${targetMonths[i]}の給与が未承認です`);
      allConfirmed = false;
    }
    months.push({
      yearMonth: targetMonths[i],
      totalSalary: sal.totalSalary,
      paymentBasisDays: sal.paymentBasisDays,
    });
  }

  if (months.length < 3) {
    return {
      eligible: false, employeeId: input.employeeId, employeeName,
      changeMonth: input.changeMonth, months, averageSalary: null,
      currentHealthGrade: null, currentPensionGrade: null,
      currentHealthStandardRemuneration: null, currentPensionStandardRemuneration: null,
      newHealthGrade: null, newPensionGrade: null,
      newHealthStandardRemuneration: null, newPensionStandardRemuneration: null,
      healthGradeDiff: null, pensionGradeDiff: null,
      effectiveMonth: null, reasons: [], failReasons,
    };
  }

  // ③ 支払基礎日数チェック
  const empSnaps = await db.collection(`companies/${companyId}/employees/${input.employeeId}/employments`)
    .orderBy('effectiveDate', 'desc').limit(1).get();
  const isPartTime = empSnaps.docs.length > 0 && (empSnaps.docs[0].data() as EmploymentDoc).employmentType === 'partTime';
  const minDays = isPartTime ? 11 : 17;

  for (const m of months) {
    if (m.paymentBasisDays < minDays) {
      failReasons.push(`${m.yearMonth}の支払基礎日数（${m.paymentBasisDays}日）が基準（${minDays}日）未満です`);
    }
  }
  const allDaysOk = months.every(m => m.paymentBasisDays >= minDays);

  // 3か月平均
  const averageSalary = Math.round(months.reduce((s, m) => s + m.totalSalary, 0) / 3);

  // 現在の等級を取得
  const gradeSnaps = await db.collection(`companies/${companyId}/employees/${input.employeeId}/grades`)
    .orderBy('effectiveMonth', 'desc').limit(1).get();
  if (gradeSnaps.empty) {
    failReasons.push('現在の等級データがありません');
    return {
      eligible: false, employeeId: input.employeeId, employeeName,
      changeMonth: input.changeMonth, months, averageSalary,
      currentHealthGrade: null, currentPensionGrade: null,
      currentHealthStandardRemuneration: null, currentPensionStandardRemuneration: null,
      newHealthGrade: null, newPensionGrade: null,
      newHealthStandardRemuneration: null, newPensionStandardRemuneration: null,
      healthGradeDiff: null, pensionGradeDiff: null,
      effectiveMonth: null, reasons: [], failReasons,
    };
  }
  const currentGrade = gradeSnaps.docs[0].data() as GradeDoc;

  // 新等級を算出 — 等級表を使って平均報酬から等級を逆引き
  const officeSnap = await db.doc(`companies/${companyId}/offices/${emp.officeId}`).get();
  const office = officeSnap.data()!;
  const prefectureCode = office.prefectureCode;

  const healthRate = await findApplicableRate({
    companyId, insuranceType: 'health', yearMonth: month3, prefectureCode,
  });
  const pensionRate = await findApplicableRate({
    companyId, insuranceType: 'pension', yearMonth: month3,
  });

  let newHealthGrade: number | null = null;
  let newHealthSR: number | null = null;
  let newPensionGrade: number | null = null;
  let newPensionSR: number | null = null;

  if (healthRate?.gradeTable) {
    const entry = lookupGrade(healthRate.gradeTable, averageSalary);
    if (entry) {
      newHealthGrade = entry.gradeNumber;
      newHealthSR = entry.standardRemuneration;
    }
  }
  if (pensionRate?.gradeTable) {
    const entry = lookupGrade(pensionRate.gradeTable, averageSalary);
    if (entry) {
      newPensionGrade = entry.gradeNumber;
      newPensionSR = entry.standardRemuneration;
    }
  }

  // ④ 2等級以上の差
  const healthDiff = newHealthGrade != null ? newHealthGrade - currentGrade.healthGradeNumber : null;
  const pensionDiff = newPensionGrade != null ? newPensionGrade - currentGrade.pensionGradeNumber : null;

  const healthGradeDiffAbs = healthDiff != null ? Math.abs(healthDiff) : 0;
  const pensionGradeDiffAbs = pensionDiff != null ? Math.abs(pensionDiff) : 0;
  const hasGradeDiff = healthGradeDiffAbs >= 2 || pensionGradeDiffAbs >= 2;

  if (!hasGradeDiff) {
    failReasons.push(`等級差が2等級未満です（健保: ${healthDiff ?? '?'}, 厚年: ${pensionDiff ?? '?'}）`);
  }

  // ① 固定的賃金の変動チェック — 変動月の前月と比較
  const prevMonth = addMonths(month1, -1);
  const prevSalSnap = await db.doc(`companies/${companyId}/employees/${input.employeeId}/salaries/${prevMonth}`).get();
  let fixedWageChanged = true;
  let fixedWageDirection: 'up' | 'down' | 'none' = 'none';
  if (prevSalSnap.exists) {
    const prevSal = prevSalSnap.data()! as SalaryDoc;
    const curSal = salarySnaps[0].data()! as SalaryDoc;
    const prevFixed = prevSal.totalFixedWage;
    const curFixed = curSal.totalFixedWage;
    if (prevFixed === curFixed) {
      fixedWageChanged = false;
      failReasons.push('固定的賃金に変動がありません');
    } else {
      fixedWageDirection = curFixed > prevFixed ? 'up' : 'down';
    }
  }

  // ⑤ 変動方向の一致
  const gradeDirection = (healthDiff ?? 0) > 0 || (pensionDiff ?? 0) > 0 ? 'up'
    : (healthDiff ?? 0) < 0 || (pensionDiff ?? 0) < 0 ? 'down' : 'none';

  let directionMatch = true;
  if (fixedWageDirection !== 'none' && gradeDirection !== 'none' && fixedWageDirection !== gradeDirection) {
    directionMatch = false;
    failReasons.push(`固定的賃金の変動方向（${fixedWageDirection === 'up' ? '昇給' : '減給'}）と等級の変動方向（${gradeDirection === 'up' ? '上昇' : '低下'}）が一致しません`);
  }

  const eligible = allConfirmed && allDaysOk && hasGradeDiff && fixedWageChanged && directionMatch;

  const effectiveMonth = addMonths(month1, 3);

  const reasons: string[] = [];
  if (eligible) {
    reasons.push(`変動月${month1}から3か月の平均報酬: ${averageSalary.toLocaleString()}円`);
    if (healthDiff != null) reasons.push(`健保等級: ${currentGrade.healthGradeNumber} → ${newHealthGrade} (${healthDiff > 0 ? '+' : ''}${healthDiff})`);
    if (pensionDiff != null) reasons.push(`厚年等級: ${currentGrade.pensionGradeNumber} → ${newPensionGrade} (${pensionDiff > 0 ? '+' : ''}${pensionDiff})`);
    reasons.push(`新等級適用月: ${effectiveMonth}`);
  }

  return {
    eligible,
    employeeId: input.employeeId,
    employeeName,
    changeMonth: input.changeMonth,
    months,
    averageSalary,
    currentHealthGrade: currentGrade.healthGradeNumber,
    currentPensionGrade: currentGrade.pensionGradeNumber,
    currentHealthStandardRemuneration: currentGrade.healthStandardRemuneration,
    currentPensionStandardRemuneration: currentGrade.pensionStandardRemuneration,
    newHealthGrade,
    newPensionGrade,
    newHealthStandardRemuneration: newHealthSR,
    newPensionStandardRemuneration: newPensionSR,
    healthGradeDiff: healthDiff,
    pensionGradeDiff: pensionDiff,
    effectiveMonth: eligible ? effectiveMonth : null,
    reasons,
    failReasons,
  };
}
