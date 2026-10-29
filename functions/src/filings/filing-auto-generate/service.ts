import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { EmployeeDoc, OfficeDoc, GradeDoc, EmploymentDoc } from '../../types/firestore';
import { MutationResponse } from '../../types/response';
import { notFound } from '../../utils/errors';
import { toDateString } from '../../utils/firestore';
import { FilingAutoGenerateInput } from './schema';

function tsToDate(ts: Timestamp): string {
  return toDateString(ts);
}

function genderLabel(g: string): string {
  return g === 'male' ? '男' : '女';
}

function employmentTypeLabel(t: string): string {
  return t === 'regular' ? '一般' : t === 'partTime' ? 'パート' : '契約';
}

async function buildFormData(
  companyId: string,
  employeeId: string,
  employee: EmployeeDoc,
  office: OfficeDoc,
  filingType: string,
  effectiveDate: string,
  yearMonth?: string,
): Promise<Record<string, unknown>> {
  const base = `companies/${companyId}`;

  const common = {
    '事業所整理記号': office.officeNumber ?? '',
    '事業所名称': office.name ?? '',
    '被保険者整理番号': employee.employeeNumber ?? '',
    '被保険者氏名': `${employee.lastName} ${employee.firstName}`,
    '被保険者氏名フリガナ': `${employee.lastNameKana} ${employee.firstNameKana}`,
    '生年月日': employee.birthDate ? tsToDate(employee.birthDate) : '',
    '性別': genderLabel(employee.gender),
    '個人番号': (employee as any).myNumber ?? '',
    '基礎年金番号': (employee as any).basicPensionNumber ?? '',
  };

  if (filingType === 'acquisitionNotification') {
    const empSnap = await db.collection(`${base}/employees/${employeeId}/employments`)
      .orderBy('effectiveDate', 'desc').limit(1).get();
    const employment = empSnap.empty ? null : empSnap.docs[0].data() as EmploymentDoc;

    const gradeSnap = await db.collection(`${base}/employees/${employeeId}/grades`)
      .where('effectiveMonth', '<=', effectiveDate.slice(0, 7))
      .orderBy('effectiveMonth', 'desc').limit(1).get();
    const grade = gradeSnap.empty ? null : gradeSnap.docs[0].data() as GradeDoc;

    return {
      ...common,
      '届出区分': '資格取得届',
      '資格取得年月日': employee.hireDate ? tsToDate(employee.hireDate) : effectiveDate,
      '取得区分': '新規',
      '被保険者種別': employmentTypeLabel(employment?.employmentType ?? 'regular'),
      '報酬月額_通貨': employment?.baseSalary ?? 0,
      '報酬月額_現物': 0,
      '報酬月額_合計': (employment?.baseSalary ?? 0),
      '健康保険_等級': grade?.healthGradeNumber ?? null,
      '健康保険_標準報酬月額': grade?.healthStandardRemuneration ?? null,
      '厚生年金_等級': grade?.pensionGradeNumber ?? null,
      '厚生年金_標準報酬月額': grade?.pensionStandardRemuneration ?? null,
      '備考': '',
    };
  }

  if (filingType === 'lossNotification') {
    const gradeSnap = await db.collection(`${base}/employees/${employeeId}/grades`)
      .orderBy('effectiveMonth', 'desc').limit(1).get();
    const grade = gradeSnap.empty ? null : gradeSnap.docs[0].data() as GradeDoc;

    return {
      ...common,
      '届出区分': '資格喪失届',
      '資格喪失年月日': effectiveDate,
      '喪失原因': employee.resignationDate ? '退職等' : '70歳到達等',
      '退職年月日': employee.resignationDate ? tsToDate(employee.resignationDate) : null,
      '最終標準報酬月額_健康保険': grade?.healthStandardRemuneration ?? null,
      '最終標準報酬月額_厚生年金': grade?.pensionStandardRemuneration ?? null,
      '備考': '',
    };
  }

  if (filingType === 'remunerationMonthlyChange') {
    const targetMonth = yearMonth ?? effectiveDate.slice(0, 7);
    const salarySnaps = await db.collection(`${base}/employees/${employeeId}/salaries`)
      .where('yearMonth', '<=', targetMonth)
      .orderBy('yearMonth', 'desc').limit(3).get();

    const salaries = salarySnaps.docs.map(d => {
      const s = d.data();
      return { yearMonth: s.yearMonth, totalSalary: s.totalSalary, paymentBasisDays: s.paymentBasisDays };
    }).reverse();

    const gradeSnap = await db.collection(`${base}/employees/${employeeId}/grades`)
      .where('effectiveMonth', '<=', targetMonth)
      .orderBy('effectiveMonth', 'desc').limit(1).get();
    const grade = gradeSnap.empty ? null : gradeSnap.docs[0].data() as GradeDoc;

    const avg = salaries.length > 0
      ? Math.round(salaries.reduce((s, r) => s + r.totalSalary, 0) / salaries.length)
      : null;

    return {
      ...common,
      '届出区分': '月額変更届',
      '改定年月': targetMonth,
      '従前の標準報酬月額_健康保険': grade?.healthStandardRemuneration ?? null,
      '従前の等級_健康保険': grade?.healthGradeNumber ?? null,
      '従前の標準報酬月額_厚生年金': grade?.pensionStandardRemuneration ?? null,
      '従前の等級_厚生年金': grade?.pensionGradeNumber ?? null,
      '昇降給月': salaries.length > 0 ? salaries[0].yearMonth : null,
      '1月目_年月': salaries[0]?.yearMonth ?? null,
      '1月目_通貨': salaries[0]?.totalSalary ?? null,
      '1月目_支払基礎日数': salaries[0]?.paymentBasisDays ?? null,
      '2月目_年月': salaries[1]?.yearMonth ?? null,
      '2月目_通貨': salaries[1]?.totalSalary ?? null,
      '2月目_支払基礎日数': salaries[1]?.paymentBasisDays ?? null,
      '3月目_年月': salaries[2]?.yearMonth ?? null,
      '3月目_通貨': salaries[2]?.totalSalary ?? null,
      '3月目_支払基礎日数': salaries[2]?.paymentBasisDays ?? null,
      '合計': salaries.reduce((s, r) => s + r.totalSalary, 0),
      '平均額': avg,
      '備考': '',
    };
  }

  if (filingType === 'remunerationMonthlyAlgorithm') {
    const year = effectiveDate.slice(0, 4);
    const months = ['04', '05', '06'].map(m => `${year}-${m}`);
    const salarySnaps = await db.collection(`${base}/employees/${employeeId}/salaries`)
      .where('yearMonth', '>=', months[0])
      .where('yearMonth', '<=', months[2])
      .orderBy('yearMonth', 'asc').get();

    const salaries = salarySnaps.docs.map(d => {
      const s = d.data();
      return { yearMonth: s.yearMonth, totalSalary: s.totalSalary, paymentBasisDays: s.paymentBasisDays };
    });

    const gradeSnap = await db.collection(`${base}/employees/${employeeId}/grades`)
      .where('effectiveMonth', '<=', effectiveDate.slice(0, 7))
      .orderBy('effectiveMonth', 'desc').limit(1).get();
    const grade = gradeSnap.empty ? null : gradeSnap.docs[0].data() as GradeDoc;

    const validSalaries = salaries.filter(s => s.paymentBasisDays >= 17);
    const avg = validSalaries.length > 0
      ? Math.round(validSalaries.reduce((s, r) => s + r.totalSalary, 0) / validSalaries.length)
      : null;

    const apr = salaries.find(s => s.yearMonth.endsWith('-04'));
    const may = salaries.find(s => s.yearMonth.endsWith('-05'));
    const jun = salaries.find(s => s.yearMonth.endsWith('-06'));

    return {
      ...common,
      '届出区分': '算定基礎届',
      '対象年': year,
      '従前の標準報酬月額_健康保険': grade?.healthStandardRemuneration ?? null,
      '従前の等級_健康保険': grade?.healthGradeNumber ?? null,
      '従前の標準報酬月額_厚生年金': grade?.pensionStandardRemuneration ?? null,
      '従前の等級_厚生年金': grade?.pensionGradeNumber ?? null,
      '4月_通貨': apr?.totalSalary ?? null,
      '4月_支払基礎日数': apr?.paymentBasisDays ?? null,
      '5月_通貨': may?.totalSalary ?? null,
      '5月_支払基礎日数': may?.paymentBasisDays ?? null,
      '6月_通貨': jun?.totalSalary ?? null,
      '6月_支払基礎日数': jun?.paymentBasisDays ?? null,
      '合計': (apr?.totalSalary ?? 0) + (may?.totalSalary ?? 0) + (jun?.totalSalary ?? 0),
      '平均額': avg,
      '備考': '',
    };
  }

  if (filingType === 'dependentChange') {
    const depSnap = await db.collection(`${base}/employees/${employeeId}/dependents`)
      .where('deletedAt', '==', null).get();

    const dependents = depSnap.docs.map(d => {
      const dep = d.data();
      return {
        '氏名': `${dep.lastName} ${dep.firstName}`,
        '生年月日': tsToDate(dep.birthDate),
        '性別': genderLabel(dep.gender),
        '続柄': dep.relationship,
        '同居別居': dep.coResident ? '同居' : '別居',
        '年間収入': dep.income ?? 0,
      };
    });

    return {
      ...common,
      '届出区分': '被扶養者（異動）届',
      '届出年月日': effectiveDate,
      '被扶養者一覧': dependents,
      '備考': '',
    };
  }

  if (filingType === 'bonusPayment') {
    const targetMonth = yearMonth ?? effectiveDate.slice(0, 7);
    const bonusSnap = await db.doc(`${base}/employees/${employeeId}/bonuses/${targetMonth}`).get();
    const bonus = bonusSnap.exists ? bonusSnap.data()! : null;

    const insSnap = await db.doc(`${base}/employees/${employeeId}/bonusInsurance/${targetMonth}`).get();
    const ins = insSnap.exists ? insSnap.data()! : null;

    return {
      ...common,
      '届出区分': '賞与支払届',
      '賞与支払年月日': effectiveDate,
      '賞与額_通貨': bonus?.totalAmount ?? 0,
      '賞与額_現物': 0,
      '賞与額_合計': bonus?.totalAmount ?? 0,
      '標準賞与額': bonus?.standardBonusAmount ?? null,
      '年度累計標準賞与額': bonus?.cumulativeBonusAmount ?? null,
      '健康保険料_被保険者': ins?.healthInsurance?.employeeAmount ?? null,
      '厚生年金保険料_被保険者': ins?.pensionInsurance?.employeeAmount ?? null,
      '備考': '',
    };
  }

  return { ...common, '備考': '' };
}

export async function autoGenerateFiling(
  input: FilingAutoGenerateInput,
  auth: AuthContext,
): Promise<MutationResponse> {
  const empRef = db.doc(`companies/${auth.companyId}/employees/${input.employeeId}`);
  const empSnap = await empRef.get();
  if (!empSnap.exists || empSnap.data()!.deletedAt !== null) throw notFound('従業員');
  const employee = empSnap.data()! as EmployeeDoc;

  if (!auth.roles.includes('admin')) requireOffice(auth, employee.officeId);

  const officeSnap = await db.doc(`companies/${auth.companyId}/offices/${employee.officeId}`).get();
  if (!officeSnap.exists) throw notFound('事業所');
  const office = officeSnap.data()! as OfficeDoc;

  const formData = await buildFormData(
    auth.companyId, input.employeeId, employee, office,
    input.filingType, input.effectiveDate, input.yearMonth,
  );

  const now = Timestamp.now();
  const filingRef = db
    .collection(`companies/${auth.companyId}/employees/${input.employeeId}/filings`)
    .doc();

  await filingRef.set({
    filingType: input.filingType,
    workflowStatus: 'draft',
    mockStatus: 'notStarted',
    submissionStatus: 'notSubmitted',
    effectiveDate: input.effectiveDate,
    formData,
    submittedAt: null,
    resultReceivedAt: null,
    resultNote: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
  });

  const auditRef = db.collection(`companies/${auth.companyId}/auditLogs`).doc();
  await auditRef.set({
    entity: 'filing',
    entityId: filingRef.id,
    action: 'create',
    changes: { source: { from: null, to: 'autoGenerate' } },
    performedBy: auth.uid,
    performedAt: now,
    version: 1,
  });

  const { linkFilingToProcedure } = await import('../../procedures/hooks');
  await linkFilingToProcedure({
    companyId: auth.companyId,
    employeeId: input.employeeId,
    filingId: filingRef.id,
    filingType: input.filingType,
  });

  return { success: true, id: filingRef.id };
}
