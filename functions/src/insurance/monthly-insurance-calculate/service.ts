import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import {
  EmployeeDoc,
  EmploymentDoc,
  GradeDoc,
  OfficeDoc,
  InsurancePremiumBreakdown,
} from '../../types/firestore';
import { MutationResponse } from '../../types/response';
import { notFound, invalidArg } from '../../utils/errors';
import { isLongTermCareAge, isPensionExcluded, isHealthExcluded } from '../../utils/age';
import { findAllRates, rateFingerprint } from '../../utils/insurance-rate';
import { calculateChildSupportPayment } from '../../utils/child-support-payment';
import { normalizeEmployment, qualificationDates } from '../../utils/employment';
import { decideExemption } from '../../utils/exemption-period';
import { coverageForMonth, employerOnlyPremium, lastDayOfMonth, normalizeRoundingRule, splitPremium } from '../calculator';
import { MonthlyInsuranceCalculateInput } from './schema';

const ZERO: InsurancePremiumBreakdown = { employeeAmount: 0, employerAmount: 0 };

/** 保存しない試し計算（等級の遡及訂正で、直した等級での額を先に見せる）。grade を渡すとその等級で計算する */
export interface MonthlyCalcOptions {
  dryRun?: boolean;
  grade?: Pick<GradeDoc, 'healthGradeNumber' | 'healthStandardRemuneration' | 'pensionGradeNumber' | 'pensionStandardRemuneration'>;
}

export async function calculateMonthlyInsurance(
  input: MonthlyInsuranceCalculateInput,
  auth: AuthContext,
  options: MonthlyCalcOptions = {},
): Promise<MutationResponse & { preview?: { totalEmployeeAmount: number; totalEmployerAmount: number; healthGradeNumber: number; pensionGradeNumber: number } }> {
  const empRef = db.doc(
    `companies/${auth.companyId}/employees/${input.employeeId}`,
  );

  const docId = input.yearMonth;

  const result = await db.runTransaction(async (tx) => {
    const empDoc = await tx.get(empRef);
    if (!empDoc.exists || empDoc.data()!.deletedAt !== null) {
      throw notFound('従業員');
    }
    const employee = empDoc.data()! as EmployeeDoc;

    if (!auth.roles.includes('admin')) {
      requireOffice(auth, employee.officeId);
    }

    // 資格取得月・喪失月の判定（喪失月は発生しない。月末退職・同月得喪は発生する）
    const { acquisitionDate, lossDate } = qualificationDates(employee);
    if (!acquisitionDate) throw invalidArg('資格取得日（入社日）が登録されていません');
    const coverage = coverageForMonth(acquisitionDate, lossDate, input.yearMonth);
    if (!coverage.charged) throw invalidArg(`${input.yearMonth}は保険料が発生しません（${coverage.reason}）`);

    // 対象月末時点の雇用条件で適用・適用外を判定
    const employmentSnap = await tx.get(db
      .collection(`companies/${auth.companyId}/employees/${input.employeeId}/employments`)
      .where('effectiveDate', '<=', lastDayOfMonth(input.yearMonth))
      .orderBy('effectiveDate', 'desc')
      .limit(1));
    const employment = employmentSnap.empty ? null : normalizeEmployment(employmentSnap.docs[0].data() as EmploymentDoc);
    if (employment && !employment.healthInsuranceEnrolled && !employment.pensionEnrolled) {
      throw invalidArg('社会保険の適用外のため保険料は計算しません');
    }

    // 保険料は等級から決まるため、給与の登録・承認は求めない（無給の休職者も計算する。徴収は別途入金で扱う）

    const gradesSnap = await db
      .collection(
        `companies/${auth.companyId}/employees/${input.employeeId}/grades`,
      )
      .where('effectiveMonth', '<=', input.yearMonth)
      .orderBy('effectiveMonth', 'desc')
      .limit(1)
      .get();

    if (gradesSnap.empty && !options.grade) {
      throw invalidArg('適用中の等級が見つかりません');
    }
    const grade = options.grade ?? (gradesSnap.docs[0].data() as GradeDoc);

    const officeSnap = await tx.get(
      db.doc(`companies/${auth.companyId}/offices/${employee.officeId}`),
    );
    if (!officeSnap.exists) throw notFound('事業所');
    const office = officeSnap.data()! as OfficeDoc;
    const roundingRule = normalizeRoundingRule(office.roundingRule);

    // 年齢判定と、健保・厚年それぞれの適用区分
    const healthExcluded = isHealthExcluded(employee.birthDate, input.yearMonth)
      || (employment !== null && !employment.healthInsuranceEnrolled);
    const pensionExcluded = isPensionExcluded(employee.birthDate, input.yearMonth)
      || (employment !== null && !employment.pensionEnrolled);
    const ltcAge = isLongTermCareAge(employee.birthDate, input.yearMonth);

    // 料率検索（年月・都道府県・保険者IDで適用料率を特定）
    const rates = await findAllRates(
      auth.companyId,
      input.yearMonth,
      office.prefectureCode,
      office.insurerId,
      office.healthInsuranceType,
    );

    if (!healthExcluded && !rates.health) {
      throw invalidArg('健康保険料率が設定されていません');
    }
    if (!pensionExcluded && !rates.pension) {
      throw invalidArg('厚生年金保険料率が設定されていません');
    }

    // 免除判定（届出承認済みの産休・育休。月末・育休14日の基準）
    const exemption = await decideExemption(tx, auth.companyId, input.employeeId, input.yearMonth, 'monthly');
    const isExempted = exemption.exempt;
    if (input.isExempted !== undefined && input.isExempted !== isExempted) {
      throw invalidArg('免除指定が承認済みの免除期間と一致しません。免除登録を確認してください');
    }

    // 健康保険
    const healthInsurance = (healthExcluded || isExempted || !rates.health)
      ? ZERO
      : splitPremium(grade.healthStandardRemuneration, rates.health.employeeRate, rates.health.employerRate, roundingRule, rates.health.totalRate);

    // 介護保険: 年齢自動判定（40歳以上65歳未満）
    let longTermCareInsurance: InsurancePremiumBreakdown | null = null;
    if (ltcAge && !healthExcluded) {
      if (rates.longTermCare) {
        longTermCareInsurance = isExempted
          ? ZERO
          : splitPremium(grade.healthStandardRemuneration, rates.longTermCare.employeeRate, rates.longTermCare.employerRate, roundingRule, rates.longTermCare.totalRate);
      }
    }

    // 厚生年金
    const pensionInsurance = (pensionExcluded || isExempted || !rates.pension)
      ? ZERO
      : splitPremium(grade.pensionStandardRemuneration, rates.pension.employeeRate, rates.pension.employerRate, roundingRule, rates.pension.totalRate);

    const childSupportPayment = calculateChildSupportPayment(
      grade.healthStandardRemuneration, input.yearMonth, healthExcluded || isExempted,
      roundingRule, rates.childSupportPayment,
    );

    // 子ども・子育て拠出金（事業主のみ、厚生年金の標準報酬月額が基礎）
    const childSupportContribution = (!rates.childSupport || isExempted || pensionExcluded)
      ? ZERO
      : employerOnlyPremium(grade.pensionStandardRemuneration, rates.childSupport.employerRate);

    const totalEmployeeAmount =
      healthInsurance.employeeAmount +
      (longTermCareInsurance?.employeeAmount ?? 0) +
      pensionInsurance.employeeAmount +
      childSupportPayment.employeeAmount;

    const totalEmployerAmount =
      healthInsurance.employerAmount +
      (longTermCareInsurance?.employerAmount ?? 0) +
      pensionInsurance.employerAmount +
      childSupportContribution.employerAmount + childSupportPayment.employerAmount;

    const now = Timestamp.now();
    const insuranceRef = db.doc(
      `companies/${auth.companyId}/employees/${input.employeeId}/monthlyInsurance/${docId}`,
    );

    if (options.dryRun) {
      return { docId, preview: { totalEmployeeAmount, totalEmployerAmount, healthGradeNumber: grade.healthGradeNumber, pensionGradeNumber: grade.pensionGradeNumber } };
    }
    const existingDoc = await tx.get(insuranceRef);
    if (existingDoc.exists && existingDoc.data()!.approvalPending) throw invalidArg('承認申請中の月次保険料は再計算できません');
    if (existingDoc.exists && existingDoc.data()!.isConfirmed) {
      throw invalidArg('承認済みの月次保険料は再計算できません');
    }
    const version = existingDoc.exists
      ? (existingDoc.data()!.version as number) + 1
      : 1;

    const data = {
      yearMonth: input.yearMonth,
      officeId: employee.officeId,
      healthGradeNumber: grade.healthGradeNumber,
      healthStandardRemuneration: grade.healthStandardRemuneration,
      pensionGradeNumber: grade.pensionGradeNumber,
      pensionStandardRemuneration: grade.pensionStandardRemuneration,
      healthInsurance,
      longTermCareInsurance,
      pensionInsurance,
      childSupportContribution,
      childSupportPayment,
      totalEmployeeAmount,
      totalEmployerAmount,
      isExempted,
      isHealthExcluded: healthExcluded,
      isPensionExcluded: pensionExcluded,
      isLongTermCareApplicable: ltcAge,
      exemptionIds: exemption.exemptionIds,
      sameMonthAcquisitionAndLoss: coverage.sameMonthAcquisitionAndLoss,
      roundingRule,
      rateFingerprint: rateFingerprint(rates),
      // 今の等級で計算したので、等級の変化の印（grades/outdated.ts）を外す
      gradeOutdated: false,
      lastRejection: null,
      isConfirmed: false,
      approvalPending: false,
      version,
      updatedAt: now,
    };

    if (existingDoc.exists) {
      tx.update(insuranceRef, data);
    } else {
      tx.set(insuranceRef, { ...data, createdAt: now });
    }

    const auditRef = db
      .collection(`companies/${auth.companyId}/auditLogs`)
      .doc();
    tx.set(auditRef, {
      entity: 'monthlyInsurance',
      entityId: docId,
      action: existingDoc.exists ? 'update' : 'create',
      changes: {},
      performedBy: auth.uid,
      performedAt: now,
      version,
    });

    return { docId, preview: undefined };
  });

  return { success: true, id: result.docId, ...(result.preview ? { preview: result.preview } : {}) };
}
