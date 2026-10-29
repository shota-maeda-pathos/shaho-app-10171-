import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import {
  EmployeeDoc,
  GradeDoc,
  OfficeDoc,
  InsurancePremiumBreakdown,
} from '../../types/firestore';
import { MutationResponse } from '../../types/response';
import { notFound, invalidArg } from '../../utils/errors';
import { isLongTermCareAge, isPensionExcluded, isHealthExcluded } from '../../utils/age';
import { findAllRates } from '../../utils/insurance-rate';
import { calculateChildSupportPayment } from '../../utils/child-support-payment';
import { MonthlyInsuranceCalculateInput } from './schema';

function calcPremium(
  standardRemuneration: number,
  employeeRate: number,
  employerRate: number,
  roundingRule: 'truncate' | 'round' | 'ceil',
): InsurancePremiumBreakdown {
  const roundFn =
    roundingRule === 'truncate'
      ? Math.floor
      : roundingRule === 'ceil'
        ? Math.ceil
        : Math.round;

  return {
    employeeAmount: roundFn((standardRemuneration * employeeRate) / 1000),
    employerAmount: roundFn((standardRemuneration * employerRate) / 1000),
  };
}

const ZERO: InsurancePremiumBreakdown = { employeeAmount: 0, employerAmount: 0 };

export async function calculateMonthlyInsurance(
  input: MonthlyInsuranceCalculateInput,
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

    // 対象月の給与が承認済みか確認
    const salaryRef = db.doc(
      `companies/${auth.companyId}/employees/${input.employeeId}/salaries/${input.yearMonth}`,
    );
    const salaryDoc = await tx.get(salaryRef);
    if (!salaryDoc.exists) {
      throw invalidArg(`${input.yearMonth}の給与データが登録されていません。先に給与を入力してください`);
    }
    if (!salaryDoc.data()!.isConfirmed) {
      throw invalidArg(`${input.yearMonth}の給与が未承認です。先に給与の承認を完了してください`);
    }

    const gradesSnap = await db
      .collection(
        `companies/${auth.companyId}/employees/${input.employeeId}/grades`,
      )
      .where('effectiveMonth', '<=', input.yearMonth)
      .orderBy('effectiveMonth', 'desc')
      .limit(1)
      .get();

    if (gradesSnap.empty) {
      throw invalidArg('適用中の等級が見つかりません');
    }
    const grade = gradesSnap.docs[0].data() as GradeDoc;

    const officeSnap = await tx.get(
      db.doc(`companies/${auth.companyId}/offices/${employee.officeId}`),
    );
    if (!officeSnap.exists) throw notFound('事業所');
    const office = officeSnap.data()! as OfficeDoc;
    const roundingRule = office.roundingRule ?? 'truncate';

    // 年齢判定
    const healthExcluded = isHealthExcluded(employee.birthDate, input.yearMonth);
    const pensionExcluded = isPensionExcluded(employee.birthDate, input.yearMonth);
    const ltcAge = isLongTermCareAge(employee.birthDate, input.yearMonth);

    // 料率検索（年月・都道府県・保険者IDで適用料率を特定）
    const rates = await findAllRates(
      auth.companyId,
      input.yearMonth,
      office.prefectureCode,
      office.insurerId,
    );

    if (!healthExcluded && !rates.health) {
      throw invalidArg('健康保険料率が設定されていません');
    }
    if (!pensionExcluded && !rates.pension) {
      throw invalidArg('厚生年金保険料率が設定されていません');
    }

    // 免除判定
    const exemptionsSnap = await tx.get(db
      .collection(`companies/${auth.companyId}/employees/${input.employeeId}/premiumExemptions`)
      .where('startMonth', '<=', input.yearMonth));
    const applicableExemptions = exemptionsSnap.docs.filter((doc) => {
      const d = doc.data();
      return d.status === 'active' && d.deletedAt == null && d.approvedAt != null
        && d.isMonthlyExempted === true
        && ['maternity', 'childcare'].includes(d.exemptionType)
        && (!d.endMonth || input.yearMonth <= d.endMonth);
    });
    const isExempted = applicableExemptions.length > 0;
    if (input.isExempted !== undefined && input.isExempted !== isExempted) {
      throw invalidArg('免除指定が承認済みの免除期間と一致しません。免除登録を確認してください');
    }

    // 健康保険
    const healthInsurance = (healthExcluded || isExempted || !rates.health)
      ? ZERO
      : calcPremium(grade.healthStandardRemuneration, rates.health.employeeRate, rates.health.employerRate, roundingRule);

    // 介護保険: 年齢自動判定（40歳以上65歳未満）
    let longTermCareInsurance: InsurancePremiumBreakdown | null = null;
    if (ltcAge && !healthExcluded) {
      if (rates.longTermCare) {
        longTermCareInsurance = isExempted
          ? ZERO
          : calcPremium(grade.healthStandardRemuneration, rates.longTermCare.employeeRate, rates.longTermCare.employerRate, roundingRule);
      }
    }

    // 厚生年金
    const pensionInsurance = (pensionExcluded || isExempted || !rates.pension)
      ? ZERO
      : calcPremium(grade.pensionStandardRemuneration, rates.pension.employeeRate, rates.pension.employerRate, roundingRule);

    const childSupportPayment = calculateChildSupportPayment(
      grade.healthStandardRemuneration, input.yearMonth, healthExcluded || isExempted,
      roundingRule, rates.childSupportPayment,
    );

    // 子ども・子育て拠出金（事業主のみ、厚生年金の標準報酬月額が基礎）
    let childSupportContribution: InsurancePremiumBreakdown;
    if (!rates.childSupport || isExempted || pensionExcluded) {
      childSupportContribution = ZERO;
    } else {
      childSupportContribution = calcPremium(
        grade.pensionStandardRemuneration,
        0,
        rates.childSupport.employerRate,
        roundingRule,
      );
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
      `companies/${auth.companyId}/employees/${input.employeeId}/monthlyInsurance/${docId}`,
    );

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
      exemptionIds: applicableExemptions.map((doc) => doc.id),
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

    return docId;
  });

  return { success: true, id: result };
}
