import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../../config';
import { AuthContext, requireRole } from '../../middleware/auth';
import { HEALTH_GRADE_TABLE, lookupGrade, PENSION_GRADE_TABLE } from '../../insurance/calculator';

// 組合健保のテスト用の事業所（課題の要件「協会けんぽ・組合健保に対応」の確認用）。
// 料率はここでは作らず、設定→料率の「組合健保の料率を登録する」で入れる（登録の画面もあわせて確かめるため）。

export const UNION_SET_ID = 'union-v1';
export const UNION_OFFICE_ID = 'sample-union-office';
/** 架空の保険者番号（組合健保は8桁。06 は健康保険組合の法別番号） */
export const UNION_INSURER_ID = '06139901';

export interface UnionSampleEmployee {
  id: string;
  employeeNumber: string;
  lastName: string;
  firstName: string;
  gender: 'male' | 'female';
  birthDate: string;
  salary: number;
  note: string;
}

export function buildUnionSample(): UnionSampleEmployee[] {
  const list: Omit<UnionSampleEmployee, 'id' | 'employeeNumber'>[] = [
    { lastName: '組合', firstName: '一郎', gender: 'male', birthDate: '1991-05-10', salary: 300_000, note: '35歳（介護保険なし）' },
    { lastName: '組合', firstName: '二郎', gender: 'male', birthDate: '1981-03-15', salary: 500_000, note: '45歳（介護保険あり）' },
    { lastName: '組合', firstName: '花子', gender: 'female', birthDate: '1974-08-20', salary: 280_000, note: '52歳（介護保険あり）' },
  ];
  return list.map((e, i) => {
    const n = String(i + 1).padStart(4, '0');
    return { ...e, id: `sample-union-${n}`, employeeNumber: `UNI-${n}` };
  });
}

/** 組合健保の事業所（東京・翌月控除）と従業員3名・2026年9月の等級・2026年10・11月支給の承認済みの給与を作る */
export async function seedUnionSample(auth: AuthContext) {
  requireRole(auth, 'admin');
  const base = `companies/${auth.companyId}`;
  const employees = buildUnionSample();
  const marker = db.doc(`${base}/sampleSets/${UNION_SET_ID}`);
  if ((await marker.get()).exists) return { created: 0, alreadyExists: true, officeId: UNION_OFFICE_ID, insurerId: UNION_INSURER_ID };

  const numberRefs = employees.map(e => db.doc(`${base}/employeeNumbers/${e.employeeNumber}`));
  const officeRef = db.doc(`${base}/offices/${UNION_OFFICE_ID}`);
  const existing = await db.getAll(officeRef, ...numberRefs);
  if (existing.some(d => d.exists && d.data()!.sampleSetId !== UNION_SET_ID)) {
    throw new HttpsError('already-exists', 'サンプルの事業所または社員番号が既存データと重複しています。上書きせず中断しました');
  }

  const now = Timestamp.now();
  const ts = (date: string) => Timestamp.fromDate(new Date(`${date}T00:00:00Z`));
  const shared = { isSample: true, sampleSetId: UNION_SET_ID, createdAt: now, updatedAt: now };
  const writes: { ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }[] = [];
  writes.push({ ref: officeRef, data: {
    ...shared, name: 'サンプル組合健保テスト事業所', officeNumber: 'UNI-001', prefectureCode: '13', insurerId: UNION_INSURER_ID,
    healthInsuranceType: 'union', pensionOfficeName: '新宿年金事務所',
    address: 'テスト用住所', phone: '000-0000-0000', closingDay: 0, paymentDay: 25, paymentMonth: 'current',
    deductionMethod: 'previous', roundingRule: 'statutory', bonusMonths: [], isActive: true, version: 1,
  } });
  for (const [index, e] of employees.entries()) {
    const ref = db.doc(`${base}/employees/${e.id}`);
    writes.push({ ref: numberRefs[index], data: { ...shared, employeeId: e.id } });
    writes.push({ ref, data: {
      ...shared, employeeNumber: e.employeeNumber, lastName: e.lastName, firstName: e.firstName, lastNameKana: 'クミアイ', firstNameKana: 'テスト',
      birthDate: ts(e.birthDate), gender: e.gender, officeId: UNION_OFFICE_ID, departmentId: null,
      hireDate: ts('2020-04-01'), resignationDate: null, userId: null,
      insuredPersonNumber: String(900 + index + 1), isActive: true, version: 1, deletedAt: null, sampleNote: `組合健保テスト用の架空のデータ（${e.note}）`,
    } });
    writes.push({ ref: db.doc(`${ref.path}/employments/sample-initial`), data: {
      ...shared, effectiveDate: '2020-04-01', employmentType: 'regular', weeklyHours: 40, monthlyDays: 21, baseSalary: e.salary,
      healthInsuranceEnrolled: true, pensionEnrolled: true, socialInsuranceEnrolled: true,
      insuredCategory: 'general', longTermCareEnrolled: false, note: '組合健保テスト用', version: 1,
    } });
    const h = lookupGrade(HEALTH_GRADE_TABLE, e.salary);
    const p = lookupGrade(PENSION_GRADE_TABLE, e.salary);
    writes.push({ ref: db.doc(`${ref.path}/grades/2026-09`), data: {
      ...shared, effectiveMonth: '2026-09', determinationType: 'regular',
      healthGradeNumber: h.gradeNumber, healthStandardRemuneration: h.standardRemuneration,
      pensionGradeNumber: p.gradeNumber, pensionStandardRemuneration: p.standardRemuneration,
      basisRemuneration: e.salary, basisMonths: null, reason: '定時決定（組合健保テスト用）', isConfirmed: true, version: 1,
    } });
    for (const m of ['2026-10', '2026-11']) {
      writes.push({ ref: db.doc(`${ref.path}/salaries/${m}`), data: {
        ...shared, yearMonth: m, officeId: UNION_OFFICE_ID, paymentBasisDays: 21,
        baseSalary: e.salary, fixedAllowances: {}, variableAllowances: {},
        totalFixedWage: e.salary, totalVariableWage: 0, totalSalary: e.salary, inKindAmount: 0, retroactivePay: null,
        isConfirmed: true, approvalPending: false, isPublished: false, confirmedAt: now, confirmedBy: auth.uid, version: 1,
      } });
    }
  }
  writes.push({ ref: marker, data: { ...shared, employeeCount: employees.length, officeId: UNION_OFFICE_ID, createdBy: auth.uid } });
  writes.push({ ref: db.collection(`${base}/auditLogs`).doc(), data: { entity: 'sampleSet', entityId: UNION_SET_ID, action: 'create', changes: { employeeCount: employees.length }, performedBy: auth.uid, performedAt: now, version: 1 } });

  // 目印（marker）は最後に書くので、途中で失敗したら同じ内容で書き直せる
  const batch = db.batch();
  for (const w of writes) batch.set(w.ref, w.data);
  await batch.commit();
  return { created: employees.length, alreadyExists: false, officeId: UNION_OFFICE_ID, insurerId: UNION_INSURER_ID };
}
