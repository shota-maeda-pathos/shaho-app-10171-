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
import { findAllRates, rateFingerprint } from '../../utils/insurance-rate';
import { calculateChildSupportPayment } from '../../utils/child-support-payment';
import { decideExemption } from '../../utils/exemption-period';
import { normalizeEmployment, qualificationDates } from '../../utils/employment';
import { EmploymentDoc } from '../../types/firestore';
import { employerOnlyPremium, normalizeRoundingRule, splitPremium } from '../calculator';
import { bonusCaps, bonusTarget, earlierMonthsInFiscalYear, summarizePayments, toThousand } from '../../bonus/bonus-calc';
import { BonusInsuranceCalculateInput } from './schema';

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
    const empPath = `companies/${auth.companyId}/employees/${input.employeeId}`;
    const bonus = await tx.get(db.doc(`${empPath}/bonuses/${input.yearMonth}`));
    if (!bonus.exists || bonus.data()!.isConfirmed !== true) throw invalidArg('賞与額を登録・承認してから保険料を計算してください');
    const source = bonus.data()!;
    const totalBonusAmount = source.totalAmount as number;
    const standardBonusAmount = toThousand(totalBonusAmount);
    if (!Number.isSafeInteger(totalBonusAmount) || totalBonusAmount < 0 || source.standardBonusAmount !== standardBonusAmount) {
      throw invalidArg('賞与額と標準賞与額が一致しません。賞与を登録し直してください');
    }
    if (input.totalBonusAmount !== undefined && input.totalBonusAmount !== totalBonusAmount) throw invalidArg('指定額が承認済みの賞与額と一致しません');

    // 健保の年度累計：同じ年度の前の月の承認済みの標準賞与額（免除・資格喪失月の賞与も数える）
    const earlier = await Promise.all(earlierMonthsInFiscalYear(input.yearMonth).map(ym => tx.get(db.doc(`${empPath}/bonuses/${ym}`))));
    const unconfirmed = earlier.filter(d => d.exists && d.data()!.isConfirmed !== true).map(d => d.id);
    if (unconfirmed.length) throw invalidArg(`同じ年度の前の月（${unconfirmed.join('・')}）に未承認の賞与があります。先に承認してください（年度累計を数えるため）`);
    const priorCumulative = earlier.reduce((a, d) => a + (d.exists ? Number(d.data()!.standardBonusAmount ?? 0) : 0), 0);
    const caps = bonusCaps(standardBonusAmount, priorCumulative);
    const firstPaymentDate = Array.isArray(source.payments) && source.payments.length
      ? summarizePayments(source.payments).firstPaymentDate : (source.paymentDate ?? null);

    const officeSnap = await tx.get(
      db.doc(`companies/${auth.companyId}/offices/${employee.officeId}`),
    );
    if (!officeSnap.exists) throw notFound('事業所');
    const office = officeSnap.data()! as OfficeDoc;
    const roundingRule = normalizeRoundingRule(office.roundingRule);

    // 資格と適用（支給日で判定。資格喪失月の賞与は保険料なし）
    const employmentSnap = await db.collection(`${empPath}/employments`).where('effectiveDate', '<=', `${input.yearMonth}-31`).orderBy('effectiveDate', 'desc').limit(1).get();
    const employment = employmentSnap.empty ? null : normalizeEmployment(employmentSnap.docs[0].data() as EmploymentDoc);
    const { acquisitionDate, lossDate } = qualificationDates(employee);
    const target = bonusTarget({
      yearMonth: input.yearMonth, firstPaymentDate, acquisitionDate, lossDate,
      enrolled: employment === null || employment.healthInsuranceEnrolled || employment.pensionEnrolled,
    });
    if (target.target === 'excluded') throw invalidArg(`保険料の対象ではありません（${target.reason}）`);
    const notCharged = target.target === 'lossMonth';

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
      office.healthInsuranceType,
    );

    if (!healthExcl && !notCharged && !rates.health) throw invalidArg('健康保険料率が設定されていません');
    if (!pensionExcl && !notCharged && !rates.pension) throw invalidArg('厚生年金保険料率が設定されていません');

    // 免除判定（産休：支給月の末日が休業中。育休：さらに休業期間が1か月超）
    const exemption = await decideExemption(tx, auth.companyId, input.employeeId, input.yearMonth, 'bonus');
    const isExempted = exemption.exempt;
    if (input.isExempted !== undefined && input.isExempted !== isExempted) {
      throw invalidArg('賞与免除の指定が承認済みの免除期間と一致しません。免除登録を確認してください');
    }
    const healthCappedAmount = caps.healthCapped;
    const pensionCappedAmount = caps.pensionCapped;
    const healthNone = healthExcl || isExempted || notCharged;
    const pensionNone = pensionExcl || isExempted || notCharged;

    // 健康保険
    const healthInsurance = (healthNone || !rates.health)
      ? ZERO
      : splitPremium(healthCappedAmount, rates.health.employeeRate, rates.health.employerRate, roundingRule, rates.health.totalRate);

    // 介護保険: 年齢自動判定
    let longTermCareInsurance: InsurancePremiumBreakdown | null = null;
    if (ltcAge && !healthExcl && rates.longTermCare) {
      longTermCareInsurance = isExempted || notCharged
        ? ZERO
        : splitPremium(healthCappedAmount, rates.longTermCare.employeeRate, rates.longTermCare.employerRate, roundingRule, rates.longTermCare.totalRate);
    }

    // 厚生年金
    const pensionInsurance = (pensionNone || !rates.pension)
      ? ZERO
      : splitPremium(pensionCappedAmount, rates.pension.employeeRate, rates.pension.employerRate, roundingRule, rates.pension.totalRate);

    const childSupportPayment = calculateChildSupportPayment(
      healthCappedAmount, input.yearMonth, healthNone,
      roundingRule, rates.childSupportPayment,
    );

    // 子ども・子育て拠出金（事業主のみ）
    let childSupportContribution: InsurancePremiumBreakdown;
    if (!rates.childSupport || pensionNone) {
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
      standardBonusAmount,
      priorCumulativeBonusAmount: priorCumulative,
      cumulativeBonusAmount: caps.healthCumulative,
      healthOverCap: caps.healthOverCap,
      pensionOverCap: caps.pensionOverCap,
      bonusTarget: target.target,
      bonusTargetReason: target.reason,
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
      // 計算後に料率マスタが変わったかを見分ける（毎月の保険料と同じ）
      rateFingerprint: rateFingerprint(rates),
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
