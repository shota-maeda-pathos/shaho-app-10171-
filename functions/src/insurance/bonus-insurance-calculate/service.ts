import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import {
  EmployeeDoc,
  EmploymentDoc,
  InsuranceRateDoc,
  InsurancePremiumBreakdown,
} from '../../types/firestore';
import { MutationResponse } from '../../types/response';
import { notFound, invalidArg } from '../../utils/errors';
import { BonusInsuranceCalculateInput } from './schema';

const HEALTH_BONUS_CAP = 5_730_000;
const PENSION_BONUS_CAP = 1_500_000;

function calcPremium(
  cappedAmount: number,
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
    employeeAmount: roundFn((cappedAmount * employeeRate) / 1000),
    employerAmount: roundFn((cappedAmount * employerRate) / 1000),
  };
}

function capToThousand(amount: number, cap: number): number {
  const capped = Math.min(amount, cap);
  return Math.floor(capped / 1000) * 1000;
}

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

    const officeSnap = await tx.get(
      db.doc(`companies/${auth.companyId}/offices/${employee.officeId}`),
    );
    const officeData = officeSnap.data()!;
    const roundingRule = (officeData.roundingRule ?? 'truncate') as
      | 'truncate'
      | 'round'
      | 'ceil';

    const employmentsSnap = await db
      .collection(
        `companies/${auth.companyId}/employees/${input.employeeId}/employments`,
      )
      .where('effectiveDate', '<=', input.yearMonth + '-31')
      .orderBy('effectiveDate', 'desc')
      .limit(1)
      .get();

    const employment = employmentsSnap.empty
      ? null
      : (employmentsSnap.docs[0].data() as EmploymentDoc);

    const healthRateSnap = await db
      .collection(`companies/${auth.companyId}/insuranceRates`)
      .where('insuranceType', '==', 'health')
      .where('appliedUntil', '==', null)
      .limit(1)
      .get();

    const pensionRateSnap = await db
      .collection(`companies/${auth.companyId}/insuranceRates`)
      .where('insuranceType', '==', 'pension')
      .where('appliedUntil', '==', null)
      .limit(1)
      .get();

    const childSupportRateSnap = await db
      .collection(`companies/${auth.companyId}/insuranceRates`)
      .where('insuranceType', '==', 'childSupport')
      .where('appliedUntil', '==', null)
      .limit(1)
      .get();

    if (healthRateSnap.empty || pensionRateSnap.empty) {
      throw invalidArg('保険料率が設定されていません');
    }

    const healthRate = healthRateSnap.docs[0].data() as InsuranceRateDoc;
    const pensionRate = pensionRateSnap.docs[0].data() as InsuranceRateDoc;

    const isExempted = input.isExempted ?? false;
    const healthCappedAmount = capToThousand(input.totalBonusAmount, HEALTH_BONUS_CAP);
    const pensionCappedAmount = capToThousand(input.totalBonusAmount, PENSION_BONUS_CAP);

    const healthInsurance = isExempted
      ? { employeeAmount: 0, employerAmount: 0 }
      : calcPremium(healthCappedAmount, healthRate.employeeRate, healthRate.employerRate, roundingRule);

    let longTermCareInsurance: InsurancePremiumBreakdown | null = null;
    if (employment?.longTermCareEnrolled) {
      const ltcRateSnap = await db
        .collection(`companies/${auth.companyId}/insuranceRates`)
        .where('insuranceType', '==', 'longTermCare')
        .where('appliedUntil', '==', null)
        .limit(1)
        .get();

      if (!ltcRateSnap.empty) {
        const ltcRate = ltcRateSnap.docs[0].data() as InsuranceRateDoc;
        longTermCareInsurance = isExempted
          ? { employeeAmount: 0, employerAmount: 0 }
          : calcPremium(healthCappedAmount, ltcRate.employeeRate, ltcRate.employerRate, roundingRule);
      }
    }

    const pensionInsurance = isExempted
      ? { employeeAmount: 0, employerAmount: 0 }
      : calcPremium(pensionCappedAmount, pensionRate.employeeRate, pensionRate.employerRate, roundingRule);

    let childSupportContribution: InsurancePremiumBreakdown;
    if (childSupportRateSnap.empty || isExempted) {
      childSupportContribution = { employeeAmount: 0, employerAmount: 0 };
    } else {
      const csRate = childSupportRateSnap.docs[0].data() as InsuranceRateDoc;
      childSupportContribution = calcPremium(
        healthCappedAmount,
        csRate.employeeRate,
        csRate.employerRate,
        roundingRule,
      );
    }

    const totalEmployeeAmount =
      healthInsurance.employeeAmount +
      (longTermCareInsurance?.employeeAmount ?? 0) +
      pensionInsurance.employeeAmount +
      childSupportContribution.employeeAmount;

    const totalEmployerAmount =
      healthInsurance.employerAmount +
      (longTermCareInsurance?.employerAmount ?? 0) +
      pensionInsurance.employerAmount +
      childSupportContribution.employerAmount;

    const now = Timestamp.now();
    const insuranceRef = db.doc(
      `companies/${auth.companyId}/employees/${input.employeeId}/bonusInsurance/${docId}`,
    );

    const existingDoc = await tx.get(insuranceRef);
    const version = existingDoc.exists
      ? (existingDoc.data()!.version as number) + 1
      : 1;

    const data = {
      yearMonth: input.yearMonth,
      officeId: employee.officeId,
      healthCappedAmount,
      pensionCappedAmount,
      healthInsurance,
      longTermCareInsurance,
      pensionInsurance,
      childSupportContribution,
      totalEmployeeAmount,
      totalEmployerAmount,
      isExempted,
      isConfirmed: false,
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
