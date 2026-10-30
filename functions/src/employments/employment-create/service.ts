import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { EmployeeDoc, OfficeDoc } from '../../types/firestore';
import { MutationResponse } from '../../types/response';
import { invalidArg, notFound } from '../../utils/errors';
import { judgeApplicability, ApplicabilityJudgement } from '../../insurance/calculator/applicability';
import { EmploymentCreateInput } from './schema';

/**
 * システムの適用判定と担当者の加入区分を突き合わせる。
 * 判定と異なる加入区分にする場合（非常勤役員などの手動判断を含む）は理由を必須とする。
 */
export function resolveEnrollment(input: EmploymentCreateInput, judgement: ApplicabilityJudgement) {
  const legacy = input.socialInsuranceEnrolled;
  const health = input.healthInsuranceEnrolled ?? legacy;
  const pension = input.pensionEnrolled ?? legacy;
  const expected = judgement.result === 'applicable';
  const differs = judgement.result === 'manual' || health !== expected || pension !== expected;
  if (differs && !input.overrideReason) {
    throw invalidArg(`適用判定（${judgement.reason}）と異なる加入区分にする場合は理由を入力してください`);
  }
  return { health, pension, overridden: differs };
}

export async function createEmployment(
  input: EmploymentCreateInput,
  auth: AuthContext,
): Promise<MutationResponse> {
  const empRef = db.doc(
    `companies/${auth.companyId}/employees/${input.employeeId}`,
  );

  const result = await db.runTransaction(async (tx) => {
    const empDoc = await tx.get(empRef);
    if (!empDoc.exists || empDoc.data()!.deletedAt !== null) {
      throw notFound('従業員');
    }
    const employee = empDoc.data()! as EmployeeDoc;

    if (!auth.roles.includes('admin')) {
      requireOffice(auth, employee.officeId);
    }

    const officeSnap = await tx.get(db.doc(`companies/${auth.companyId}/offices/${employee.officeId}`));
    const office = (officeSnap.exists ? officeSnap.data() : {}) as Partial<OfficeDoc>;
    const companySnap = await tx.get(db.doc(`companies/${auth.companyId}`));
    const specific = companySnap.exists ? companySnap.data()!.specificApplicableOffice : undefined;
    const contractType = input.contractType ?? (input.contractEndDate ? 'fixed' : 'indefinite');
    const judgement = judgeApplicability({
      employmentType: input.employmentType,
      weeklyHours: input.weeklyHours,
      monthlyDays: input.monthlyDays,
      fullTimeWeeklyHours: office.fullTimeWeeklyHours ?? 40,
      fullTimeMonthlyDays: office.fullTimeMonthlyDays ?? 21,
      isSpecificApplicableOffice: typeof specific === 'boolean' ? specific : null,
      contractType,
      contractStartDate: input.contractStartDate ?? input.effectiveDate,
      contractEndDate: input.contractEndDate ?? null,
      renewalExpected: input.renewalExpected ?? false,
      isStudent: input.isStudent ?? false,
    });
    const enrollment = resolveEnrollment(input, judgement);

    const now = Timestamp.now();
    const docRef = db
      .collection(
        `companies/${auth.companyId}/employees/${input.employeeId}/employments`,
      )
      .doc();

    tx.set(docRef, {
      effectiveDate: input.effectiveDate,
      employmentType: input.employmentType,
      weeklyHours: input.weeklyHours,
      monthlyDays: input.monthlyDays,
      baseSalary: input.baseSalary,
      socialInsuranceEnrolled: enrollment.health || enrollment.pension,
      longTermCareEnrolled: input.longTermCareEnrolled,
      note: input.note ?? '',
      contractType,
      contractStartDate: input.contractStartDate ?? null,
      contractEndDate: input.contractEndDate ?? null,
      renewalExpected: input.renewalExpected ?? false,
      weeklyDays: input.weeklyDays ?? null,
      workStyle: input.workStyle ?? (judgement.insuredCategory === 'shortTime' ? 'shortTime' : ['partTime', 'arbeit'].includes(input.employmentType) ? 'partTime' : 'fullTime'),
      probationStartDate: input.probationStartDate ?? null,
      probationEndDate: input.probationEndDate ?? null,
      wageType: input.wageType ?? 'monthly',
      wageAmount: input.wageAmount ?? null,
      monthlyHours: input.monthlyHours ?? null,
      healthInsuranceEnrolled: enrollment.health,
      pensionEnrolled: enrollment.pension,
      applicabilityReason: enrollment.health || enrollment.pension ? (judgement.applicabilityReason === 'excluded' ? 'standard' : judgement.applicabilityReason) : 'excluded',
      insuredCategory: judgement.insuredCategory ?? 'general',
      isStudent: input.isStudent ?? false,
      applicabilityJudgement: { result: judgement.result, reason: judgement.reason },
      applicabilityOverride: enrollment.overridden ? { reason: input.overrideReason!, by: auth.uid } : null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    // 満了の通知（ホーム）が従業員だけを読めば済むように、契約を従業員にも写す
    tx.update(empRef, { contract: { type: contractType, endDate: input.contractEndDate ?? null, renewalExpected: input.renewalExpected ?? false } });

    const auditRef = db
      .collection(`companies/${auth.companyId}/auditLogs`)
      .doc();
    tx.set(auditRef, {
      entity: 'employment',
      entityId: docRef.id,
      action: 'create',
      changes: {},
      performedBy: auth.uid,
      performedAt: now,
      version: 1,
    });

    return docRef.id;
  });

  return { success: true, id: result };
}
