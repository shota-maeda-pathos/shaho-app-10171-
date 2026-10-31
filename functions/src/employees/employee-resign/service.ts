import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { EmployeeDoc, OfficeDoc, EmploymentDoc, GradeDoc, UserDoc } from '../../types/firestore';
import { notFound } from '../../utils/errors';
import { toTimestamp, toDateString } from '../../utils/firestore';
import { normalizeEmployment, NormalizedEmployment, qualificationDates } from '../../utils/employment';
import { findAllRates } from '../../utils/insurance-rate';
import { isHealthExcluded, isLongTermCareAge, isPensionExcluded } from '../../utils/age';
import { addMonths, lossDateFromResignation, monthOf, normalizeRoundingRule, splitPremium } from '../../insurance/calculator';
import { EmployeeResignInput } from './schema';

/** 最終月の保険料の見込み額（本人負担・会社負担）。料率は事業所の都道府県・保険者のものを使う */
async function estimateLastMonthPremium(
  companyId: string,
  employee: EmployeeDoc,
  office: OfficeDoc,
  grade: GradeDoc,
  yearMonth: string,
  employment: NormalizedEmployment | null,
) {
  const rule = normalizeRoundingRule(office.roundingRule);
  const rates = await findAllRates(companyId, yearMonth, office.prefectureCode, office.insurerId, office.healthInsuranceType);
  const healthOn = (employment?.healthInsuranceEnrolled ?? true) && !isHealthExcluded(employee.birthDate, yearMonth) && rates.health;
  const pensionOn = (employment?.pensionEnrolled ?? true) && !isPensionExcluded(employee.birthDate, yearMonth) && rates.pension;
  const zero = { employeeAmount: 0, employerAmount: 0 };
  const health = healthOn ? splitPremium(grade.healthStandardRemuneration, rates.health!.employeeRate, rates.health!.employerRate, rule, rates.health!.totalRate) : zero;
  const care = healthOn && rates.longTermCare && isLongTermCareAge(employee.birthDate, yearMonth)
    ? splitPremium(grade.healthStandardRemuneration, rates.longTermCare.employeeRate, rates.longTermCare.employerRate, rule, rates.longTermCare.totalRate) : zero;
  const pension = pensionOn ? splitPremium(grade.pensionStandardRemuneration, rates.pension!.employeeRate, rates.pension!.employerRate, rule, rates.pension!.totalRate) : zero;
  return {
    healthEmployee: health.employeeAmount + care.employeeAmount,
    healthEmployer: health.employerAmount + care.employerAmount,
    pensionEmployee: pension.employeeAmount,
    pensionEmployer: pension.employerAmount,
    totalEmployee: health.employeeAmount + care.employeeAmount + pension.employeeAmount,
    totalEmployer: health.employerAmount + care.employerAmount + pension.employerAmount,
    isEstimate: true,
  };
}

export interface ResignResult {
  success: boolean;
  employeeId: string;
  filingId: string | null;
  summary: {
    employee: string;
    resignationDate: string;
    filing: string | null;
  };
}

export async function resignEmployee(
  input: EmployeeResignInput,
  auth: AuthContext,
): Promise<ResignResult> {
  const base = `companies/${auth.companyId}`;
  const docRef = db.doc(`${base}/employees/${input.employeeId}`);

  const result = await db.runTransaction(async (tx) => {
    const doc = await tx.get(docRef);
    if (!doc.exists || doc.data()!.deletedAt !== null) {
      throw notFound('従業員');
    }
    const current = doc.data()! as EmployeeDoc;

    if (current.version !== input.expectedVersion) {
      throw new HttpsError(
        'failed-precondition',
        `データが更新されています（現在のバージョン: ${current.version}）`,
      );
    }

    if (!current.isActive) {
      throw new HttpsError(
        'failed-precondition',
        'この従業員はすでに退職済みです',
      );
    }

    if (!auth.roles.includes('admin')) {
      requireOffice(auth, current.officeId);
    }

    const now = Timestamp.now();
    const resignationDate = input.resignationDate.includes('T')
      ? input.resignationDate.slice(0, 10)
      : input.resignationDate;
    const resignDateTs = toTimestamp(resignationDate);

    // 資格喪失日 = 退職日の翌日
    const lossDate = lossDateFromResignation(resignationDate);

    // --- 読み取り（トランザクションでは書き込みより前にすべて読む） ---
    const empSnap = await tx.get(
      db.collection(`${base}/employees/${input.employeeId}/employments`)
        .orderBy('effectiveDate', 'desc').limit(1),
    );
    const employment = empSnap.empty ? null : normalizeEmployment(empSnap.docs[0].data() as EmploymentDoc);
    const isSocialInsured = employment === null || employment.healthInsuranceEnrolled || employment.pensionEnrolled;

    const officeSnap = isSocialInsured ? await tx.get(db.doc(`${base}/offices/${current.officeId}`)) : null;
    const office = officeSnap?.exists ? officeSnap.data()! as OfficeDoc : null;

    const gradeSnap = isSocialInsured
      ? await tx.get(db.collection(`${base}/employees/${input.employeeId}/grades`).orderBy('effectiveMonth', 'desc').limit(1))
      : null;
    const grade = gradeSnap && !gradeSnap.empty ? gradeSnap.docs[0].data() as GradeDoc : null;

    // 最終月：保険料が発生する最後の月（月末退職は退職月、月の途中の退職は前月、同月得喪は取得月）
    const acquisitionDate = qualificationDates(current).acquisitionDate ?? resignationDate;
    const isSameMonthEntry = monthOf(acquisitionDate) === monthOf(lossDate);
    const lastChargedMonth = isSameMonthEntry ? monthOf(acquisitionDate) : addMonths(monthOf(lossDate), -1);
    const lastInsuranceSnap = isSocialInsured && grade && lastChargedMonth >= monthOf(acquisitionDate)
      ? await tx.get(db.doc(`${base}/employees/${input.employeeId}/monthlyInsurance/${lastChargedMonth}`))
      : null;
    const settlement = lastInsuranceSnap && (!lastInsuranceSnap.exists || isSameMonthEntry) && grade && office
      ? await estimateLastMonthPremium(auth.companyId, current, office, grade, lastChargedMonth, employment)
      : null;

    const userRef = current.userId ? db.doc(`${base}/users/${current.userId}`) : null;
    const userSnap = userRef ? await tx.get(userRef) : null;

    // --- 書き込み ---
    tx.update(docRef, {
      resignationDate: resignDateTs,
      qualificationLostDate: isSocialInsured ? lossDate : null,
      isActive: false,
      updatedAt: now,
      version: current.version + 1,
    });

    // 資格喪失届を自動生成
    let filingId: string | null = null;
    if (isSocialInsured) {
      const filingRef = db.collection(`${base}/employees/${input.employeeId}/filings`).doc();
      filingId = filingRef.id;
      tx.set(filingRef, {
        filingType: 'lossNotification',
        workflowStatus: 'draft',
        mockStatus: 'notStarted',
        submissionStatus: 'notSubmitted',
        effectiveDate: lossDate,
        formData: {
          '事業所整理記号': office?.officeNumber ?? '',
          '事業所名称': office?.name ?? '',
          '被保険者整理番号': current.insuredPersonNumber ?? current.employeeNumber,
          '被保険者氏名': `${current.lastName} ${current.firstName}`,
          '被保険者氏名フリガナ': `${current.lastNameKana} ${current.firstNameKana}`,
          '生年月日': current.birthDate ? toDateString(current.birthDate) : '',
          '性別': current.gender === 'male' ? '男' : '女',
          '個人番号': '',
          '基礎年金番号': '',
          '届出区分': '資格喪失届',
          '資格喪失年月日': lossDate,
          '喪失原因': '退職等',
          '退職年月日': resignationDate,
          '最終標準報酬月額_健康保険': grade?.healthStandardRemuneration ?? null,
          '最終標準報酬月額_厚生年金': grade?.pensionStandardRemuneration ?? null,
          '備考': '',
        },
        submittedAt: null,
        resultReceivedAt: null,
        resultNote: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
    }

    // 最終月保険料の精算（未計算の月、または同月得喪の場合に見込み額を登録する）
    if (settlement) {
      const collRef = db.collection(`${base}/premiumCollections`).doc();
      tx.set(collRef, {
        employeeId: input.employeeId,
        yearMonth: lastChargedMonth,
        type: 'resignation_settlement',
        ...settlement,
        status: 'uncollected',
        isSameMonthEntry,
        note: isSameMonthEntry
          ? '同月得喪のため1か月分が発生します。同じ月に別の厚生年金・国民年金の資格を取得した場合、厚生年金保険料は後日還付されます'
          : '最終月の保険料が未計算のため見込み額を登録しました。月次計算の確定後に差額を確認してください',
        createdAt: now,
        updatedAt: now,
        version: 1,
      });
    }

    // ユーザーアカウントの自動停止・権限縮小
    let userSuspended = false;
    if (userRef && userSnap?.exists) {
      const userData = userSnap.data()! as UserDoc;
      const strippedRoles = userData.roles.filter(r => r === 'employee' || r === 'viewer');
      const newRoles = strippedRoles.length > 0 ? strippedRoles : ['employee' as const];
      tx.update(userRef, {
        isSuspended: true,
        roles: newRoles,
        updatedAt: now,
      });
      userSuspended = true;
    }

    const auditRef = db.collection(`${base}/auditLogs`).doc();
    tx.set(auditRef, {
      entity: 'employee',
      entityId: input.employeeId,
      action: 'resign',
      changes: {
        resignationDate: { from: null, to: resignationDate },
        isActive: { from: true, to: false },
        filing: { from: null, to: filingId ? 'lossNotification' : 'skipped (not enrolled)' },
        userSuspended: { from: false, to: userSuspended },
      },
      performedBy: auth.uid,
      performedAt: now,
      version: current.version + 1,
    });

    return { filingId, userSuspended };
  });

  const empSnap = await docRef.get();
  const emp = empSnap.data()! as EmployeeDoc;
  const name = `${emp.lastName} ${emp.firstName}`;
  const resignationDate = input.resignationDate.includes('T')
    ? input.resignationDate.slice(0, 10)
    : input.resignationDate;

  const lossDate = lossDateFromResignation(resignationDate);

  const { createLossProcedure } = await import('../../procedures/hooks');
  await createLossProcedure({
    companyId: auth.companyId,
    employeeId: input.employeeId,
    employeeName: name,
    officeId: emp.officeId,
    resignationDate,
    lossDate,
    filingId: result.filingId,
    hasFinalSettlement: true,
    userSuspended: result.userSuspended,
    createdBy: auth.uid,
  });

  return {
    success: true,
    employeeId: input.employeeId,
    filingId: result.filingId,
    summary: {
      employee: `${name}（${emp.employeeNumber}）`,
      resignationDate,
      filing: result.filingId ? '資格喪失届を自動生成' : null,
    },
  };
}
