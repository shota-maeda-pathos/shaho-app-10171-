import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { OfficeDoc } from '../../types/firestore';
import { alreadyExists, invalidArg } from '../../utils/errors';
import { toTimestamp } from '../../utils/firestore';
import { EmployeeOnboardInput } from './schema';

const HEALTH_TABLE = [
  58000, 68000, 78000, 88000, 98000, 104000, 110000, 118000, 126000, 134000,
  142000, 150000, 160000, 170000, 180000, 190000, 200000, 220000, 240000, 260000,
  280000, 300000, 320000, 340000, 360000, 380000, 410000, 440000, 470000, 500000,
  530000, 560000, 590000, 620000, 650000, 680000, 710000, 750000, 790000, 830000,
  880000, 930000, 980000, 1030000, 1090000, 1150000, 1210000, 1270000, 1330000, 1390000,
];

const PENSION_TABLE = [
  88000, 98000, 104000, 110000, 118000, 126000, 134000, 142000, 150000, 160000,
  170000, 180000, 190000, 200000, 220000, 240000, 260000, 280000, 300000, 320000,
  340000, 360000, 380000, 410000, 440000, 470000, 500000, 530000, 560000, 590000,
  620000, 650000,
];

function lookupGrade(table: number[], salary: number): { grade: number; standard: number } {
  for (let i = 0; i < table.length; i++) {
    const lower = i === 0 ? 0 : (table[i - 1] + table[i]) / 2;
    const upper = i === table.length - 1 ? Infinity : (table[i] + table[i + 1]) / 2;
    if (salary >= lower && salary < upper) {
      return { grade: i + 1, standard: table[i] };
    }
  }
  return { grade: table.length, standard: table[table.length - 1] };
}

export interface OnboardResult {
  success: boolean;
  employeeId: string;
  employmentId: string;
  salaryId: string;
  gradeId: string | null;
  filingId: string | null;
  summary: {
    employee: string;
    employment: string;
    salary: string;
    grade: string | null;
    filing: string | null;
  };
}

export async function onboardEmployee(
  input: EmployeeOnboardInput,
  auth: AuthContext,
): Promise<OnboardResult> {
  if (!auth.roles.includes('admin')) {
    requireOffice(auth, input.officeId);
  }

  const officeDoc = await db.doc(`companies/${auth.companyId}/offices/${input.officeId}`).get();
  if (!officeDoc.exists) throw invalidArg('指定された事業所が存在しません');
  const office = officeDoc.data()! as OfficeDoc;

  const base = `companies/${auth.companyId}`;
  const now = Timestamp.now();
  const hireDate = input.hireDate;
  const hireDateTs = toTimestamp(hireDate);
  const effectiveMonth = hireDate.slice(0, 7);
  const fixed = input.fixedAllowances ?? {};
  const fixedSum = Object.values(fixed).reduce((a, b) => a + b, 0);
  const totalSalary = input.baseSalary + fixedSum;

  const health = lookupGrade(HEALTH_TABLE, totalSalary);
  const pension = lookupGrade(PENSION_TABLE, totalSalary);

  const result = await db.runTransaction(async (tx) => {
    const reserveRef = db.doc(`${base}/employeeNumbers/${input.employeeNumber}`);
    const reserveDoc = await tx.get(reserveRef);
    if (reserveDoc.exists) throw alreadyExists('この社員番号');

    const empRef = db.collection(`${base}/employees`).doc();
    const employeeId = empRef.id;

    tx.set(reserveRef, { employeeId, createdAt: now });

    tx.set(empRef, {
      employeeNumber: input.employeeNumber,
      lastName: input.lastName,
      firstName: input.firstName,
      lastNameKana: input.lastNameKana,
      firstNameKana: input.firstNameKana,
      birthDate: input.birthDate ? toTimestamp(input.birthDate) : null,
      gender: input.gender,
      officeId: input.officeId,
      departmentId: input.departmentId ?? null,
      hireDate: hireDateTs,
      resignationDate: null,
      userId: null,
      isActive: true,
      version: 1,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    const employmentRef = db.collection(`${base}/employees/${employeeId}/employments`).doc();
    tx.set(employmentRef, {
      effectiveDate: hireDate,
      employmentType: input.employmentType,
      weeklyHours: input.weeklyHours,
      monthlyDays: input.monthlyDays,
      baseSalary: input.baseSalary,
      socialInsuranceEnrolled: input.socialInsuranceEnrolled,
      longTermCareEnrolled: input.longTermCareEnrolled,
      note: '',
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    const salaryRef = db.doc(`${base}/employees/${employeeId}/salaries/${effectiveMonth}`);
    tx.set(salaryRef, {
      yearMonth: effectiveMonth,
      paymentBasisDays: input.monthlyDays,
      baseSalary: input.baseSalary,
      fixedAllowances: fixed,
      variableAllowances: {},
      totalFixedWage: input.baseSalary + fixedSum,
      totalVariableWage: 0,
      totalSalary,
      isConfirmed: false,
      confirmedAt: null,
      confirmedBy: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    let gradeId: string | null = null;
    let filingId: string | null = null;

    if (input.socialInsuranceEnrolled) {
      const gradeRef = db.doc(`${base}/employees/${employeeId}/grades/${effectiveMonth}`);
      gradeId = effectiveMonth;
      tx.set(gradeRef, {
        effectiveMonth,
        healthGradeNumber: health.grade,
        healthStandardRemuneration: health.standard,
        pensionGradeNumber: pension.grade,
        pensionStandardRemuneration: pension.standard,
        determinationType: 'initial',
        reason: '入社時決定',
        version: 1,
        createdAt: now,
        updatedAt: now,
      });

      const filingRef = db.collection(`${base}/employees/${employeeId}/filings`).doc();
      filingId = filingRef.id;
      const empTypeLabel = input.employmentType === 'regular' ? '一般'
        : input.employmentType === 'partTime' ? 'パート' : '契約';
      tx.set(filingRef, {
        filingType: 'acquisitionNotification',
        workflowStatus: 'draft',
        mockStatus: 'notStarted',
        submissionStatus: 'notSubmitted',
        effectiveDate: hireDate,
        formData: {
          '事業所整理記号': office.officeNumber,
          '事業所名称': office.name,
          '被保険者整理番号': input.employeeNumber,
          '被保険者氏名': `${input.lastName} ${input.firstName}`,
          '被保険者氏名フリガナ': `${input.lastNameKana} ${input.firstNameKana}`,
          '生年月日': input.birthDate || '',
          '性別': input.gender === 'male' ? '男' : '女',
          '個人番号': '',
          '基礎年金番号': '',
          '届出区分': '資格取得届',
          '資格取得年月日': hireDate,
          '取得区分': '新規',
          '被保険者種別': empTypeLabel,
          '報酬月額_通貨': input.baseSalary,
          '報酬月額_現物': 0,
          '報酬月額_合計': totalSalary,
          '健康保険_等級': health.grade,
          '健康保険_標準報酬月額': health.standard,
          '厚生年金_等級': pension.grade,
          '厚生年金_標準報酬月額': pension.standard,
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

    const auditRef = db.collection(`${base}/auditLogs`).doc();
    tx.set(auditRef, {
      entity: 'employee',
      entityId: employeeId,
      action: 'onboard',
      changes: {
        employment: { from: null, to: 'created' },
        salary: { from: null, to: effectiveMonth },
        grade: { from: null, to: gradeId ? 'created' : 'skipped (not enrolled)' },
        filing: { from: null, to: filingId ? 'acquisitionNotification' : 'skipped' },
      },
      performedBy: auth.uid,
      performedAt: now,
      version: 1,
    });

    return { employeeId, employmentId: employmentRef.id, gradeId, filingId };
  });

  const name = `${input.lastName} ${input.firstName}`;

  const { createAcquisitionProcedure } = await import('../../procedures/hooks');
  await createAcquisitionProcedure({
    companyId: auth.companyId,
    employeeId: result.employeeId,
    employeeName: name,
    officeId: input.officeId,
    effectiveDate: hireDate,
    filingId: result.filingId,
    createdBy: auth.uid,
  });

  return {
    success: true,
    employeeId: result.employeeId,
    employmentId: result.employmentId,
    salaryId: effectiveMonth,
    gradeId: result.gradeId,
    filingId: result.filingId,
    summary: {
      employee: `${name}（${input.employeeNumber}）を登録`,
      employment: `${input.employmentType === 'regular' ? '正社員' : input.employmentType === 'partTime' ? 'パートタイム' : '契約社員'}・基本給 ${input.baseSalary.toLocaleString()}円`,
      salary: `${effectiveMonth}の給与データを作成`,
      grade: result.gradeId
        ? `健保${health.grade}等級（${health.standard.toLocaleString()}円）/ 厚年${pension.grade}等級（${pension.standard.toLocaleString()}円）`
        : null,
      filing: result.filingId ? '資格取得届を自動生成' : null,
    },
  };
}
