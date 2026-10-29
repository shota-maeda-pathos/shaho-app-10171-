import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { EmployeeDoc, SalaryDoc, GradeDoc, EmploymentDoc } from '../../types/firestore';
import { invalidArg, notFound } from '../../utils/errors';
import { createApprovalRequest } from '../../approvals/approval-request-create/service';
import { findApplicableRate } from '../../utils/insurance-rate';
import { normalizeEmployment } from '../../utils/employment';
import {
  addMonths, ChangeDirection, judgeGradeChange, occasionalRevisionAverage, occasionalRevisionMinDays,
  remunerationForJudgement, resolveGradeTable, RevisionJudgement,
} from '../../insurance/calculator';
import { GradeRevisionCheckInput } from './schema';

export interface RevisionCheckResult {
  eligible: boolean;
  employeeId: string;
  employeeName: string;
  changeMonth: string;
  months: { yearMonth: string; totalSalary: number; paymentBasisDays: number; remuneration: number }[];
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
  /** 健保・厚年それぞれの判定（保険ごとに別々に判定する） */
  healthEligible: boolean;
  pensionEligible: boolean;
  /** 自動では決められず、担当者の確認が必要 */
  needsReview: boolean;
  insuredCategory: string;
}

function emptyResult(base: Pick<RevisionCheckResult, 'employeeId' | 'employeeName' | 'changeMonth' | 'months' | 'averageSalary' | 'failReasons' | 'insuredCategory'>): RevisionCheckResult {
  return {
    ...base,
    eligible: false,
    currentHealthGrade: null, currentPensionGrade: null,
    currentHealthStandardRemuneration: null, currentPensionStandardRemuneration: null,
    newHealthGrade: null, newPensionGrade: null,
    newHealthStandardRemuneration: null, newPensionStandardRemuneration: null,
    healthGradeDiff: null, pensionGradeDiff: null,
    effectiveMonth: null, reasons: [],
    healthEligible: false, pensionEligible: false, needsReview: false,
  };
}

/**
 * 随時改定（産休・育休終了時改定を含む）の判定。
 * ① 固定的賃金の変動 ② 変動月から3か月の報酬 ③ 3か月とも支払基礎日数が基準以上
 * ④ 等級差（随時改定は2等級、終了時改定は1等級。上限・下限の特例あり） ⑤ 変動方向の一致
 * ④⑤は健保・厚年で別々に判定する。
 */
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
  const isLeaveEnd = input.revisionType === 'leaveEnd';

  const month1 = input.changeMonth;
  const month2 = addMonths(month1, 1);
  const month3 = addMonths(month1, 2);
  const targetMonths = [month1, month2, month3];

  const salarySnaps = await Promise.all(
    targetMonths.map(ym =>
      db.doc(`companies/${companyId}/employees/${input.employeeId}/salaries/${ym}`).get()
    )
  );

  // ② 3か月分の承認済み給与
  const months: RevisionCheckResult['months'] = [];
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
      // 判定用：現物給与を含め、遡及差額を除く
      remuneration: remunerationForJudgement({ totalSalary: sal.totalSalary, inKind: sal.inKindAmount, retroactiveAmount: sal.retroactivePay?.amount }),
    });
  }

  // ③ 支払基礎日数：被保険者の区分で基準が変わる（一般・パート17日、短時間労働者11日）
  const empSnaps = await db.collection(`companies/${companyId}/employees/${input.employeeId}/employments`)
    .orderBy('effectiveDate', 'desc').limit(1).get();
  const insuredCategory = empSnaps.empty ? 'general' : normalizeEmployment(empSnaps.docs[0].data() as EmploymentDoc).insuredCategory;

  if (months.length < 3) {
    return emptyResult({ employeeId: input.employeeId, employeeName, changeMonth: input.changeMonth, months, averageSalary: null, failReasons, insuredCategory });
  }

  const minDays = occasionalRevisionMinDays(insuredCategory);
  const average = occasionalRevisionAverage(months, insuredCategory);
  for (const ym of average.shortMonths) {
    const m = months.find(x => x.yearMonth === ym)!;
    failReasons.push(`${ym}の支払基礎日数（${m.paymentBasisDays}日）が基準（${minDays}日）未満です`);
  }
  // 3か月平均（円未満切捨て）。日数が足りない場合も参考として表示する
  const averageSalary = average.average ?? Math.floor(months.reduce((sum, m) => sum + m.remuneration, 0) / 3);

  // 変動月の時点で適用されている等級
  const gradeSnaps = await db.collection(`companies/${companyId}/employees/${input.employeeId}/grades`)
    .where('effectiveMonth', '<=', month1)
    .orderBy('effectiveMonth', 'desc').limit(1).get();
  if (gradeSnaps.empty) {
    failReasons.push('現在の等級データがありません');
    return emptyResult({ employeeId: input.employeeId, employeeName, changeMonth: input.changeMonth, months, averageSalary, failReasons, insuredCategory });
  }
  const currentGrade = gradeSnaps.docs[0].data() as GradeDoc;

  // ① 固定的賃金の変動と方向：変動月と前月の固定的賃金を比べる（終了時改定は変動を要件としない）
  let fixedWageChanged = true;
  let direction: ChangeDirection | null = null;
  let needsReview = false;
  if (!isLeaveEnd) {
    const prevMonth = addMonths(month1, -1);
    const prevSalSnap = await db.doc(`companies/${companyId}/employees/${input.employeeId}/salaries/${prevMonth}`).get();
    const curSal = salarySnaps[0].data()! as SalaryDoc;
    const prevFixed = prevSalSnap.exists ? (prevSalSnap.data() as SalaryDoc).totalFixedWage : curSal.previousTotalFixedWage ?? null;
    if (prevFixed === null || prevFixed === undefined) {
      needsReview = true;
      failReasons.push(`${prevMonth}の給与がないため固定的賃金の変動を確認できません。変動の有無と方向を確認してください`);
    } else if (prevFixed === curSal.totalFixedWage) {
      fixedWageChanged = false;
      failReasons.push('固定的賃金に変動がありません');
    } else {
      direction = curSal.totalFixedWage > prevFixed ? 'up' : 'down';
    }
  }

  // ④⑤ 健保・厚年で別々に判定する
  const officeSnap = await db.doc(`companies/${companyId}/offices/${emp.officeId}`).get();
  const office = officeSnap.data() ?? {};
  const healthRate = await findApplicableRate({
    companyId, insuranceType: 'health', yearMonth: month3, prefectureCode: office.prefectureCode, insurerId: office.insurerId,
  });
  const pensionRate = await findApplicableRate({ companyId, insuranceType: 'pension', yearMonth: month3 });

  const judge = (kind: 'health' | 'pension'): RevisionJudgement => {
    const currentStandard = kind === 'health' ? currentGrade.healthStandardRemuneration : currentGrade.pensionStandardRemuneration;
    return judgeGradeChange({
      kind,
      table: resolveGradeTable(kind, (kind === 'health' ? healthRate : pensionRate)?.gradeTable),
      currentStandard,
      averageRemuneration: averageSalary,
      // 終了時改定・方向不明の場合は、等級の動きの向きで等級差だけを判定する
      direction: direction ?? (averageSalary >= currentStandard ? 'up' : 'down'),
      minDiff: isLeaveEnd ? 1 : 2,
      previousRemuneration: null,
    });
  };
  const health = judge('health');
  const pension = judge('pension');
  if (health.needsReview || pension.needsReview) needsReview = true;

  const prerequisites = allConfirmed && average.allMonthsQualified && fixedWageChanged && (isLeaveEnd || direction !== null);
  const healthEligible = prerequisites && health.eligible;
  const pensionEligible = prerequisites && pension.eligible;
  const eligible = healthEligible || pensionEligible;
  // どちらかの保険で改定対象なら、もう一方の「等級差不足」は失敗理由に含めない
  for (const j of [health, pension]) {
    if (!j.eligible && !(eligible && j.reason.includes('等級差'))) failReasons.push(j.reason);
  }

  const healthDiff = health.newGrade.gradeNumber - currentGrade.healthGradeNumber;
  const pensionDiff = pension.newGrade.gradeNumber - currentGrade.pensionGradeNumber;

  // 変動月から4か月目に新等級を適用する
  const effectiveMonth = addMonths(month1, 3);

  const reasons: string[] = [];
  if (eligible) {
    reasons.push(`変動月${month1}から3か月の平均報酬: ${averageSalary.toLocaleString()}円`);
    reasons.push(healthEligible
      ? `健保等級: ${currentGrade.healthGradeNumber} → ${health.newGrade.gradeNumber} (${healthDiff > 0 ? '+' : ''}${healthDiff})`
      : `健保等級: ${currentGrade.healthGradeNumber}（改定なし）`);
    reasons.push(pensionEligible
      ? `厚年等級: ${currentGrade.pensionGradeNumber} → ${pension.newGrade.gradeNumber} (${pensionDiff > 0 ? '+' : ''}${pensionDiff})`
      : `厚年等級: ${currentGrade.pensionGradeNumber}（改定なし）`);
    reasons.push(`新等級適用月: ${effectiveMonth}`);
  }

  if (eligible && !isLeaveEnd) {
    const { createSimpleProcedure } = await import('../../procedures/hooks');
    const existingProcs = await db
      .collection(`companies/${companyId}/procedures`)
      .where('employeeId', '==', input.employeeId)
      .where('procedureType', '==', 'monthly_change')
      .where('status', 'in', ['draft', 'in_progress'])
      .where('deletedAt', '==', null)
      .limit(1)
      .get();
    if (existingProcs.empty) {
      await createSimpleProcedure({
        companyId,
        procedureType: 'monthly_change',
        employeeId: input.employeeId,
        employeeName,
        officeId: emp.officeId,
        effectiveDate: `${effectiveMonth}-01`,
        completedStepId: 'detect',
        createdBy: auth.uid,
      });
    }
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
    // 改定対象でない保険は現在の等級のまま
    newHealthGrade: healthEligible ? health.newGrade.gradeNumber : currentGrade.healthGradeNumber,
    newPensionGrade: pensionEligible ? pension.newGrade.gradeNumber : currentGrade.pensionGradeNumber,
    newHealthStandardRemuneration: healthEligible ? health.newGrade.standardRemuneration : currentGrade.healthStandardRemuneration,
    newPensionStandardRemuneration: pensionEligible ? pension.newGrade.standardRemuneration : currentGrade.pensionStandardRemuneration,
    healthGradeDiff: healthDiff,
    pensionGradeDiff: pensionDiff,
    effectiveMonth: eligible ? effectiveMonth : null,
    reasons,
    failReasons,
    healthEligible,
    pensionEligible,
    needsReview,
    insuredCategory,
  };
}

/**
 * 随時改定（終了時改定）の承認申請。画面から送られた値は使わず、サーバーで再判定した結果で申請する。
 * 承認されると変動月から4か月目を適用開始月とする等級が作られる。
 */
export async function submitGradeRevision(input: GradeRevisionCheckInput, auth: AuthContext): Promise<{ requestId: string; effectiveMonth: string }> {
  const result = await checkGradeRevision(input, auth);
  if (result.needsReview) throw invalidArg(`担当者の確認が必要です：${result.failReasons.join('／')}`);
  if (!result.eligible || !result.effectiveMonth) throw invalidArg(`改定の対象ではありません：${result.failReasons.join('／')}`);
  const isLeaveEnd = input.revisionType === 'leaveEnd';
  const response = await createApprovalRequest({
    companyId: auth.companyId,
    employeeId: input.employeeId,
    targetPath: `companies/${auth.companyId}/employees/${input.employeeId}/grades/${result.effectiveMonth}`,
    targetVersion: 0,
    requestType: 'grade',
    metadata: {
      effectiveMonth: result.effectiveMonth,
      determinationType: isLeaveEnd ? 'leaveEnd' : 'occasional',
      healthGradeNumber: result.newHealthGrade,
      healthStandardRemuneration: result.newHealthStandardRemuneration,
      pensionGradeNumber: result.newPensionGrade,
      pensionStandardRemuneration: result.newPensionStandardRemuneration,
      basisRemuneration: result.averageSalary,
      basisMonths: result.months.map(m => m.yearMonth),
      reason: `${isLeaveEnd ? '産休・育休終了時改定' : '随時改定'} 変動月${result.changeMonth} 3か月平均${result.averageSalary?.toLocaleString()}円`,
      source: isLeaveEnd ? 'leaveEndRevision' : 'occasionalRevision',
    },
  }, auth);
  return { requestId: response.id, effectiveMonth: result.effectiveMonth };
}
