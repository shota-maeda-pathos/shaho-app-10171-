import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import {
  EmployeeDoc,
  OfficeDoc,
  InsurancePremiumBreakdown,
} from '../../types/firestore';
import { MutationResponse } from '../../types/response';
import { notFound, invalidArg } from '../../utils/errors';
import { isLongTermCareAge, isPensionExcluded, isHealthExcluded } from '../../utils/age';
import { findAllRates } from '../../utils/insurance-rate';
import { calculateChildSupportPayment } from '../../utils/child-support-payment';
import { decideExemption } from '../../utils/exemption-period';
import { employerOnlyPremium, normalizeRoundingRule, splitPremium } from '../calculator';
import { BonusInsuranceCalculateInput } from './schema';

const HEALTH_BONUS_CAP = 5_730_000;
const PENSION_BONUS_CAP = 1_500_000;

function capToThousand(amount: number, cap: number): number {
  const capped = Math.min(amount, cap);
  return Math.floor(capped / 1000) * 1000;
}

const ZERO: InsurancePremiumBreakdown = { employeeAmount: 0, employerAmount: 0 };

export async function calculateBonusInsurance(
  input: BonusInsuranceCalculateInput,
  auth: AuthContext,
): Promise<MutationResponse> {
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
    const bonus = await tx.get(db.doc(`companies/${auth.companyId}/employees/${input.employeeId}/bonuses/${input.yearMonth}`));
    if (!bonus.exists || bonus.data()!.isConfirmed !== true) throw invalidArg('賞与額を登録・承認してから保険料を計算してください');
    const source = bonus.data()!;
    const totalBonusAmount = source.totalAmount as number;
    const standardBonusAmount = Math.floor(totalBonusAmount / 1000) * 1000;
    if (!Number.isSafeInteger(totalBonusAmount) || totalBonusAmount < 0 || source.standardBonusAmount !== standardBonusAmount ||
        !Number.isSafeInteger(source.cumulativeBonusAmount) || source.cumulativeBonusAmount < standardBonusAmount || source.cumulativeBonusAmount % 1000 !== 0) {
      throw invalidArg('賞与額または年度累計を確認してください');
    }
    if (input.totalBonusAmount !== undefined && input.totalBonusAmount !== totalBonusAmount) throw invalidArg('指定額が承認済みの賞与額と一致しません');

    const officeSnap = await tx.get(
      db.doc(`companies/${auth.companyId}/offices/${employee.officeId}`),
    );
    if (!officeSnap.exists) throw notFound('事業所');
    const office = officeSnap.data()! as OfficeDoc;
    const roundingRule = normalizeRoundingRule(office.roundingRule);

    // 年齢判定
    const healthExcl = isHealthExcluded(employee.birthDate, input.yearMonth);
    const pensionExcl = isPensionExcluded(employee.birthDate, input.yearMonth);
    const ltcAge = isLongTermCareAge(employee.birthDate, input.yearMonth);

    // 料率検索
    const rates = await findAllRates(
      auth.companyId,
      input.yearMonth,
      office.prefectureCode,
      office.insurerId,
    );

    if (!healthExcl && !rates.health) throw invalidArg('健康保険料率が設定されていません');
    if (!pensionExcl && !rates.pension) throw invalidArg('厚生年金保険料率が設定されていません');

    // 免除判定（産休：支給月の末日が休業中。育休：さらに休業期間が1か月超）
    const exemption = await decideExemption(tx, auth.companyId, input.employeeId, input.yearMonth, 'bonus');
    const isExempted = exemption.exempt;
    if (input.isExempted !== undefined && input.isExempted !== isExempted) {
      throw invalidArg('賞与免除の指定が承認済みの免除期間と一致しません。免除登録を確認してください');
    }
    const priorCumulative = source.cumulativeBonusAmount - standardBonusAmount;
    const healthCappedAmount = capToThousand(standardBonusAmount, Math.max(0, HEALTH_BONUS_CAP - priorCumulative));
    const pensionCappedAmount = capToThousand(standardBonusAmount, PENSION_BONUS_CAP);

    // 健康保険
    const healthInsurance = (healthExcl || isExempted || !rates.health)
      ? ZERO
      : splitPremium(healthCappedAmount, rates.health.employeeRate, rates.health.employerRate, roundingRule, rates.health.totalRate);

    // 介護保険: 年齢自動判定
    let longTermCareInsurance: InsurancePremiumBreakdown | null = null;
    if (ltcAge && !healthExcl && rates.longTermCare) {
      longTermCareInsurance = isExempted
        ? ZERO
        : splitPremium(healthCappedAmount, rates.longTermCare.employeeRate, rates.longTermCare.employerRate, roundingRule, rates.longTermCare.totalRate);
    }

    // 厚生年金
    const pensionInsurance = (pensionExcl || isExempted || !rates.pension)
      ? ZERO
      : splitPremium(pensionCappedAmount, rates.pension.employeeRate, rates.pension.employerRate, roundingRule, rates.pension.totalRate);

    const childSupportPayment = calculateChildSupportPayment(
      healthCappedAmount, input.yearMonth, healthExcl || isExempted,
      roundingRule, rates.childSupportPayment,
    );

    // 子ども・子育て拠出金（事業主のみ）
    let childSupportContribution: InsurancePremiumBreakdown;
    if (!rates.childSupport || isExempted || pensionExcl) {
      childSupportContribution = ZERO;
    } else {
      childSupportContribution = employerOnlyPremium(pensionCappedAmount, rates.childSupport.employerRate);
    }

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
      `companies/${auth.companyId}/employees/${input.employeeId}/bonusInsurance/${docId}`,
    );

    const existingDoc = await tx.get(insuranceRef);
    if (existingDoc.exists && existingDoc.data()!.approvalPending) throw invalidArg('承認申請中の賞与保険料は再計算できません');
    if (existingDoc.exists && existingDoc.data()!.isConfirmed) throw invalidArg('承認済みの賞与保険料は再計算できません');
    const version = existingDoc.exists
      ? (existingDoc.data()!.version as number) + 1
      : 1;

    const data = {
      yearMonth: input.yearMonth,
      bonusVersion: source.version,
      totalBonusAmount,
      cumulativeBonusAmount: source.cumulativeBonusAmount,
      officeId: employee.officeId,
      healthCappedAmount,
      pensionCappedAmount,
      healthInsurance,
      longTermCareInsurance,
      pensionInsurance,
      childSupportContribution,
      childSupportPayment,
      totalEmployeeAmount,
      totalEmployerAmount,
      isExempted,
      isHealthExcluded: healthExcl,
      isPensionExcluded: pensionExcl,
      isLongTermCareApplicable: ltcAge,
      exemptionIds: exemption.exemptionIds,
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
      entity: 'bonusInsurance',
      entityId: docId,
      action: existingDoc.exists ? 'update' : 'create',
      changes: {},
      performedBy: auth.uid,
      performedAt: now,
      version,
    });

    return docId;
  });

  return { success: true, id: result };
}
