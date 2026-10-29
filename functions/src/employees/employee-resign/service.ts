import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { EmployeeDoc, OfficeDoc, EmploymentDoc, GradeDoc, UserDoc } from '../../types/firestore';
import { notFound } from '../../utils/errors';
import { toTimestamp, toDateString } from '../../utils/firestore';
import { EmployeeResignInput } from './schema';

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
    const lossDateObj = new Date(resignationDate);
    lossDateObj.setDate(lossDateObj.getDate() + 1);
    const lossDate = lossDateObj.toISOString().slice(0, 10);

    tx.update(docRef, {
      resignationDate: resignDateTs,
      isActive: false,
      updatedAt: now,
      version: current.version + 1,
    });

    // 資格喪失届を自動生成
    let filingId: string | null = null;
    const empSnap = await tx.get(
      db.collection(`${base}/employees/${input.employeeId}/employments`)
        .orderBy('effectiveDate', 'desc').limit(1),
    );
    const employment = empSnap.empty ? null : empSnap.docs[0].data() as EmploymentDoc;
    const isSocialInsured = employment?.socialInsuranceEnrolled !== false;

    const officeSnap = isSocialInsured ? await tx.get(db.doc(`${base}/offices/${current.officeId}`)) : null;
    const office = officeSnap?.exists ? officeSnap.data()! as OfficeDoc : null;

    const gradeSnap = isSocialInsured
      ? await tx.get(db.collection(`${base}/employees/${input.employeeId}/grades`).orderBy('effectiveMonth', 'desc').limit(1))
      : null;
    const grade = gradeSnap && !gradeSnap.empty ? gradeSnap.docs[0].data() as GradeDoc : null;

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
          '被保険者整理番号': current.employeeNumber,
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

    // 最終月保険料精算
    if (isSocialInsured && grade) {
      const resignMonth = resignationDate.slice(0, 7);
      const hireMonth = current.hireDate ? toDateString(current.hireDate).slice(0, 7) : null;
      const isSameMonthEntry = hireMonth === resignMonth;

      const lastInsuranceSnap = await tx.get(
        db.doc(`${base}/employees/${input.employeeId}/monthlyInsurance/${resignMonth}`),
      );

      if (!lastInsuranceSnap.exists || isSameMonthEntry) {
        const officeData = office ?? { roundingRule: 'truncate' as const };
        const roundingRule = (officeData as any).roundingRule ?? 'truncate';
        const roundFn = roundingRule === 'truncate' ? Math.floor : roundingRule === 'ceil' ? Math.ceil : Math.round;

        const healthEmployee = roundFn((grade.healthStandardRemuneration * 50) / 1000);
        const pensionEmployee = roundFn((grade.pensionStandardRemuneration * 91.5) / 1000);
        const totalEmployee = healthEmployee + pensionEmployee;
        const healthEmployer = roundFn((grade.healthStandardRemuneration * 50) / 1000);
        const pensionEmployer = roundFn((grade.pensionStandardRemuneration * 91.5) / 1000);
        const totalEmployer = healthEmployer + pensionEmployer;

        const collRef = db.collection(`${base}/premiumCollections`).doc();
        tx.set(collRef, {
          employeeId: input.employeeId,
          yearMonth: resignMonth,
          type: 'resignation_settlement',
          healthEmployee, pensionEmployee, totalEmployee,
          healthEmployer, pensionEmployer, totalEmployer,
          status: 'uncollected',
          isSameMonthEntry,
          createdAt: now,
          updatedAt: now,
          version: 1,
        });
      }
    }

    // ユーザーアカウントの自動停止・権限縮小
    let userSuspended = false;
    if (current.userId) {
      const userRef = db.doc(`${base}/users/${current.userId}`);
      const userSnap = await tx.get(userRef);
      if (userSnap.exists) {
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
