import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config';
import { AuthContext, requireRole } from '../middleware/auth';
import { HEALTH_GRADE_TABLE, lookupGrade, PENSION_GRADE_TABLE } from '../insurance/calculator';

export const AGE_SET_ID = 'age-v1';
export const AGE_OFFICE_ID = 'sample-age-office';

export interface AgeSampleEmployee {
  id: string;
  employeeNumber: string;
  lastName: string;
  firstName: string;
  gender: 'male' | 'female';
  birthDate: string;
  note: string;
  /** 今の等級を決めた報酬月額 */
  gradeRemuneration: number;
  /** 2026年8〜10月支給の給与（固定的賃金・非固定的賃金） */
  fixed: number;
  variable: number;
  /** 70歳を過ぎて厚生年金に入っていない */
  over70: boolean;
  spouse?: { lastName: string; firstName: string; birthDate: string };
}

/** 2026年10〜11月に年齢に達する人を1人ずつ用意する（東京の今日を2026年10月末として作った） */
export function buildAgeSample(): AgeSampleEmployee[] {
  const list: Omit<AgeSampleEmployee, 'id' | 'employeeNumber'>[] = [
    { lastName: '四十', firstName: '一郎', gender: 'male', birthDate: '1986-11-20', note: '40歳到達（11月19日。11月分から介護保険料）', gradeRemuneration: 300_000, fixed: 300_000, variable: 0, over70: false },
    { lastName: '六十五', firstName: '二郎', gender: 'male', birthDate: '1961-11-10', note: '65歳到達（11月9日。介護保険料は10月分まで）', gradeRemuneration: 300_000, fixed: 300_000, variable: 0, over70: false },
    { lastName: '七十', firstName: '三郎', gender: 'male', birthDate: '1956-11-15', note: '70歳到達（11月14日）。報酬は変わらない（届出不要）', gradeRemuneration: 300_000, fixed: 300_000, variable: 5_000, over70: false },
    { lastName: '七十', firstName: '四郎', gender: 'male', birthDate: '1956-12-01', note: '70歳到達（12月1日生まれのため11月30日）。再雇用で報酬が下がった（届出あり）', gradeRemuneration: 300_000, fixed: 250_000, variable: 0, over70: false },
    { lastName: '七十', firstName: '五郎', gender: 'male', birthDate: '1956-10-20', note: '70歳到達（10月19日。まだ手続きしていない）', gradeRemuneration: 360_000, fixed: 360_000, variable: 0, over70: false },
    { lastName: '七十五', firstName: '六郎', gender: 'male', birthDate: '1951-11-25', note: '75歳到達（11月25日に健保喪失）。配偶者が被扶養者', gradeRemuneration: 260_000, fixed: 260_000, variable: 0, over70: true,
      spouse: { lastName: '七十五', firstName: '春子', birthDate: '1955-05-05' } },
    { lastName: '七十五', firstName: '七郎', gender: 'male', birthDate: '1951-11-01', note: '75歳到達（11月1日生まれのため11月1日に健保喪失。健保は10月分まで）', gradeRemuneration: 200_000, fixed: 200_000, variable: 0, over70: true },
  ];
  return list.map((e, i) => {
    const n = String(i + 1).padStart(4, '0');
    return { ...e, id: `sample-age-${n}`, employeeNumber: `AGE-${n}` };
  });
}

/** 年齢到達のテスト用の事業所（東京・協会けんぽ・翌月控除）と従業員・等級・2026年8〜10月支給の承認済みの給与を作る */
export async function seedAgeSample(auth: AuthContext) {
  requireRole(auth, 'admin');
  const base = `companies/${auth.companyId}`;
  const employees = buildAgeSample();
  const marker = db.doc(`${base}/sampleSets/${AGE_SET_ID}`);
  if ((await marker.get()).exists) return { created: 0, alreadyExists: true, officeId: AGE_OFFICE_ID };

  const numberRefs = employees.map(e => db.doc(`${base}/employeeNumbers/${e.employeeNumber}`));
  const officeRef = db.doc(`${base}/offices/${AGE_OFFICE_ID}`);
  const existing = await db.getAll(officeRef, ...numberRefs);
  if (existing.some(d => d.exists && d.data()!.sampleSetId !== AGE_SET_ID)) {
    throw new HttpsError('already-exists', 'サンプルの事業所または社員番号が既存データと重複しています。上書きせず中断しました');
  }

  const now = Timestamp.now();
  const ts = (date: string) => Timestamp.fromDate(new Date(`${date}T00:00:00Z`));
  const shared = { isSample: true, sampleSetId: AGE_SET_ID, createdAt: now, updatedAt: now };
  const writes: { ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }[] = [];
  writes.push({ ref: officeRef, data: {
    ...shared, name: 'サンプル年齢到達テスト事業所', officeNumber: 'AGE-001', prefectureCode: '13', insurerId: '01130012',
    address: 'テスト用住所', phone: '000-0000-0000', closingDay: 0, paymentDay: 25, paymentMonth: 'current',
    deductionMethod: 'previous', roundingRule: 'statutory', bonusMonths: [], isActive: true, version: 1,
  } });
  for (const [index, e] of employees.entries()) {
    const ref = db.doc(`${base}/employees/${e.id}`);
    writes.push({ ref: numberRefs[index], data: { ...shared, employeeId: e.id } });
    writes.push({ ref, data: {
      ...shared, employeeNumber: e.employeeNumber, lastName: e.lastName, firstName: e.firstName, lastNameKana: 'テスト', firstNameKana: 'テスト',
      birthDate: ts(e.birthDate), gender: e.gender, officeId: AGE_OFFICE_ID, departmentId: null,
      hireDate: ts('2010-04-01'), resignationDate: null, userId: null,
      insuredPersonNumber: String(800 + index + 1), isActive: true, version: 1, deletedAt: null, sampleNote: `年齢到達テスト用の架空のデータ（${e.note}）`,
    } });
    writes.push({ ref: db.doc(`${ref.path}/employments/sample-initial`), data: {
      ...shared, effectiveDate: '2010-04-01', employmentType: 'regular', weeklyHours: 40, monthlyDays: 21, baseSalary: e.fixed,
      healthInsuranceEnrolled: true, pensionEnrolled: !e.over70, socialInsuranceEnrolled: true,
      insuredCategory: 'general', longTermCareEnrolled: false, note: '年齢到達テスト用', version: 1,
    } });
    const h = lookupGrade(HEALTH_GRADE_TABLE, e.gradeRemuneration);
    const p = lookupGrade(PENSION_GRADE_TABLE, e.gradeRemuneration);
    writes.push({ ref: db.doc(`${ref.path}/grades/2026-09`), data: {
      ...shared, effectiveMonth: '2026-09', determinationType: 'regular',
      healthGradeNumber: h.gradeNumber, healthStandardRemuneration: h.standardRemuneration,
      pensionGradeNumber: p.gradeNumber, pensionStandardRemuneration: p.standardRemuneration,
      basisRemuneration: e.gradeRemuneration, basisMonths: null, reason: '定時決定（年齢到達テスト用）', isConfirmed: true, version: 1,
    } });
    for (const m of ['2026-08', '2026-09', '2026-10']) {
      writes.push({ ref: db.doc(`${ref.path}/salaries/${m}`), data: {
        ...shared, yearMonth: m, officeId: AGE_OFFICE_ID, paymentBasisDays: 21,
        baseSalary: e.fixed, fixedAllowances: {}, variableAllowances: e.variable ? { '残業手当': e.variable } : {},
        totalFixedWage: e.fixed, totalVariableWage: e.variable, totalSalary: e.fixed + e.variable, inKindAmount: 0, retroactivePay: null,
        isConfirmed: true, approvalPending: false, isPublished: false, confirmedAt: now, confirmedBy: auth.uid, version: 1,
      } });
    }
    if (e.spouse) {
      writes.push({ ref: db.doc(`${ref.path}/dependents/sample-spouse`), data: {
        ...shared, lastName: e.spouse.lastName, firstName: e.spouse.firstName, lastNameKana: 'テスト', firstNameKana: 'テスト',
        birthDate: ts(e.spouse.birthDate), gender: 'female', relationship: 'spouse', isDisabled: false, income: 0, coResident: true,
        qualificationDate: ts('2010-04-01'), disqualificationDate: null, disqualificationReason: null, certification: 'certified', deletedAt: null,
      } });
    }
  }
  writes.push({ ref: marker, data: { ...shared, employeeCount: employees.length, officeId: AGE_OFFICE_ID, createdBy: auth.uid } });
  writes.push({ ref: db.collection(`${base}/auditLogs`).doc(), data: { entity: 'sampleSet', entityId: AGE_SET_ID, action: 'create', changes: { employeeCount: employees.length }, performedBy: auth.uid, performedAt: now, version: 1 } });

  // 目印（marker）は最後に書くので、途中で失敗したら同じ内容で書き直せる
  const batch = db.batch();
  for (const w of writes) batch.set(w.ref, w.data);
  await batch.commit();
  return { created: employees.length, alreadyExists: false, officeId: AGE_OFFICE_ID };
}
