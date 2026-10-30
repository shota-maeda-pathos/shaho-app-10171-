import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config';
import { AuthContext, requireRole } from '../middleware/auth';
import { HEALTH_GRADE_TABLE, lookupGrade, PENSION_GRADE_TABLE } from '../insurance/calculator';

export const CHANGE_SET_ID = 'change-v1';
export const CHANGE_OFFICE_ID = 'sample-change-office';
/** 異動先（別の都道府県・別の適用事業所） */
export const CHANGE_OFFICE_OSAKA_ID = 'sample-change-office-osaka';

interface ChangeSampleEmployee {
  id: string; employeeNumber: string; lastName: string; firstName: string; note: string;
  employmentType: 'regular' | 'contract' | 'partTime'; weeklyHours: number; salary: number; enrolled: boolean;
  contract: { endDate: string; renewalExpected: boolean } | null;
}

export function buildChangeSample(): ChangeSampleEmployee[] {
  const list: Omit<ChangeSampleEmployee, 'id' | 'employeeNumber'>[] = [
    { lastName: '更新', firstName: '一子', note: '有期契約（11月30日まで・更新の見込みあり）。契約の更新の確認用', employmentType: 'contract', weeklyHours: 40, salary: 280_000, enrolled: true, contract: { endDate: '2026-11-30', renewalExpected: true } },
    { lastName: '満了', firstName: '二子', note: '有期契約（11月15日まで・更新の見込みなし）。満了の知らせと退職への導線の確認用', employmentType: 'contract', weeklyHours: 40, salary: 250_000, enrolled: true, contract: { endDate: '2026-11-15', renewalExpected: false } },
    { lastName: '短縮', firstName: '三郎', note: '正社員。12月からパート（週20時間）になり加入から外れる（資格喪失届）', employmentType: 'regular', weeklyHours: 40, salary: 300_000, enrolled: true, contract: null },
    { lastName: '転換', firstName: '四郎', note: 'パート（週20時間・加入なし）。12月から正社員になり加入する（資格取得届）', employmentType: 'partTime', weeklyHours: 20, salary: 120_000, enrolled: false, contract: null },
    { lastName: '異動', firstName: '五郎', note: '12月1日に大阪の事業所へ異動（別の適用事業所・料率が変わる）', employmentType: 'regular', weeklyHours: 40, salary: 320_000, enrolled: true, contract: null },
    { lastName: '兼業', firstName: '六子', note: '二以上事業所勤務の登録の確認用', employmentType: 'regular', weeklyHours: 40, salary: 260_000, enrolled: true, contract: null },
  ];
  return list.map((e, i) => {
    const n = String(i + 1).padStart(4, '0');
    return { ...e, id: `sample-change-${n}`, employeeNumber: `CHG-${n}` };
  });
}

/** 雇用条件の変更・有期雇用・事業所間異動のテスト用の事業所2つ（東京・大阪）と従業員・等級・給与を作る */
export async function seedChangeSample(auth: AuthContext) {
  requireRole(auth, 'admin');
  const base = `companies/${auth.companyId}`;
  const employees = buildChangeSample();
  const marker = db.doc(`${base}/sampleSets/${CHANGE_SET_ID}`);
  if ((await marker.get()).exists) return { created: 0, alreadyExists: true, officeId: CHANGE_OFFICE_ID };
  const numberRefs = employees.map(e => db.doc(`${base}/employeeNumbers/${e.employeeNumber}`));
  const officeRefs = [db.doc(`${base}/offices/${CHANGE_OFFICE_ID}`), db.doc(`${base}/offices/${CHANGE_OFFICE_OSAKA_ID}`)];
  const existing = await db.getAll(...officeRefs, ...numberRefs);
  if (existing.some(d => d.exists && d.data()!.sampleSetId !== CHANGE_SET_ID)) {
    throw new HttpsError('already-exists', 'サンプルの事業所または社員番号が既存データと重複しています。上書きせず中断しました');
  }
  const now = Timestamp.now();
  const ts = (date: string) => Timestamp.fromDate(new Date(`${date}T00:00:00Z`));
  const shared = { isSample: true, sampleSetId: CHANGE_SET_ID, createdAt: now, updatedAt: now };
  const officeBase = { address: 'テスト用住所', phone: '000-0000-0000', closingDay: 0, paymentDay: 25, paymentMonth: 'current', deductionMethod: 'previous', roundingRule: 'statutory', bonusMonths: [], isActive: true, version: 1 };
  const batch = db.batch();
  batch.set(officeRefs[0], { ...shared, ...officeBase, name: 'サンプル変更テスト事業所', officeNumber: 'CHG-001', prefectureCode: '13', insurerId: '01130012', pensionOfficeName: '新宿年金事務所' });
  batch.set(officeRefs[1], { ...shared, ...officeBase, name: 'サンプル変更テスト大阪事業所', officeNumber: 'CHG-002', prefectureCode: '27', insurerId: '01270019', pensionOfficeName: '天満年金事務所' });
  for (const [index, e] of employees.entries()) {
    const ref = db.doc(`${base}/employees/${e.id}`);
    batch.set(numberRefs[index], { ...shared, employeeId: e.id });
    batch.set(ref, {
      ...shared, employeeNumber: e.employeeNumber, lastName: e.lastName, firstName: e.firstName, lastNameKana: 'テスト', firstNameKana: 'テスト',
      birthDate: ts('1985-06-15'), gender: e.firstName.endsWith('子') ? 'female' : 'male', officeId: CHANGE_OFFICE_ID, departmentId: null,
      hireDate: ts('2024-04-01'), resignationDate: null, userId: null, insuredPersonNumber: String(900 + index + 1),
      isActive: true, version: 1, deletedAt: null, sampleNote: `変更テスト用の架空のデータ（${e.note}）`,
      contract: e.contract ? { type: 'fixed', endDate: e.contract.endDate, renewalExpected: e.contract.renewalExpected } : { type: 'indefinite', endDate: null, renewalExpected: false },
    });
    batch.set(db.doc(`${ref.path}/employments/sample-initial`), {
      ...shared, effectiveDate: e.contract ? '2026-06-01' : '2024-04-01', employmentType: e.employmentType, weeklyHours: e.weeklyHours,
      monthlyDays: e.weeklyHours >= 30 ? 21 : 12, baseSalary: e.salary, wageType: 'monthly', wageAmount: e.salary,
      contractType: e.contract ? 'fixed' : 'indefinite', contractStartDate: e.contract ? '2026-06-01' : null, contractEndDate: e.contract?.endDate ?? null,
      renewalExpected: e.contract?.renewalExpected ?? false,
      healthInsuranceEnrolled: e.enrolled, pensionEnrolled: e.enrolled, socialInsuranceEnrolled: e.enrolled,
      applicabilityReason: e.enrolled ? 'standard' : 'excluded', insuredCategory: 'general', longTermCareEnrolled: true, isStudent: false,
      note: '変更テスト用', version: 1,
    });
    if (e.enrolled) {
      const h = lookupGrade(HEALTH_GRADE_TABLE, e.salary);
      const p = lookupGrade(PENSION_GRADE_TABLE, e.salary);
      batch.set(db.doc(`${ref.path}/grades/2026-09`), {
        ...shared, effectiveMonth: '2026-09', determinationType: 'regular', healthGradeNumber: h.gradeNumber, healthStandardRemuneration: h.standardRemuneration,
        pensionGradeNumber: p.gradeNumber, pensionStandardRemuneration: p.standardRemuneration, basisRemuneration: e.salary, basisMonths: null,
        reason: '定時決定（変更テスト用）', isConfirmed: true, version: 1,
      });
    }
  }
  batch.set(marker, { ...shared, employeeCount: employees.length, officeId: CHANGE_OFFICE_ID, createdBy: auth.uid });
  batch.set(db.collection(`${base}/auditLogs`).doc(), { entity: 'sampleSet', entityId: CHANGE_SET_ID, action: 'create', changes: { employeeCount: employees.length }, performedBy: auth.uid, performedAt: now, version: 1 });
  await batch.commit();
  return { created: employees.length, alreadyExists: false, officeId: CHANGE_OFFICE_ID };
}
