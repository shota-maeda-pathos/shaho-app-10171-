// 毎月の処理を大人数で確かめるための架空のサンプル（負荷テスト用の事業所と従業員）
import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../../config';
import { AuthContext, requireRole } from '../../middleware/auth';
import { HEALTH_GRADE_TABLE, PENSION_GRADE_TABLE, lookupGrade } from '../../insurance/calculator';

export const LOAD_SET_ID = 'load-v1';
export const LOAD_OFFICE_ID = 'sample-load-office';

const LAST = ['佐藤', '鈴木', '高橋', '田中', '伊藤', '渡辺', '山本', '中村', '小林', '加藤', '吉田', '山田', '佐々木', '山口', '松本', '井上', '木村', '林', '斎藤', '清水'];
const FIRST = ['一郎', '花子', '健太', '由美', '翔', '美咲', '大輔', '彩', '拓也', '恵', '誠', '舞', '亮', '直美', '修', '綾', '剛', '葵', '涼', '静香'];

export interface LoadEmployee {
  id: string;
  employeeNumber: string;
  lastName: string;
  firstName: string;
  birthDate: string;
  remuneration: number;
  /** 等級を登録しない人（「計算できません」の表示を確かめる） */
  noGrade: boolean;
}

/** n人分の架空の従業員。年齢（介護・70歳以上）と報酬を散らし、数人は等級なしにする */
export function buildLoadEmployees(count: number): LoadEmployee[] {
  return Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    // 1956〜2003年生まれ。40〜64歳（介護あり）と70歳以上（厚年なし）が混ざる
    const year = 1956 + (n * 7) % 48;
    const month = (n * 5) % 12 + 1;
    const day = (n * 3) % 28 + 1;
    return {
      id: `sample-load-${String(n).padStart(4, '0')}`,
      employeeNumber: `LOAD-${String(n).padStart(4, '0')}`,
      lastName: LAST[i % LAST.length],
      firstName: FIRST[Math.floor(i / LAST.length) % FIRST.length],
      birthDate: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      remuneration: 180_000 + ((n * 37) % 43) * 10_000,
      noGrade: n % 150 === 0,
    };
  });
}

/**
 * 負荷テスト用の事業所（東京・協会けんぽ・翌月控除）と count 名の従業員を作る。給与は作らない（毎月の処理で取り込む）。
 * 同じ組は一度しか作らない。既存のデータは上書きしない。
 */
export async function seedLoadSample(auth: AuthContext, count: number) {
  requireRole(auth, 'admin');
  const base = `companies/${auth.companyId}`;
  const marker = db.doc(`${base}/sampleSets/${LOAD_SET_ID}`);
  if ((await marker.get()).exists) return { created: 0, alreadyExists: true, officeId: LOAD_OFFICE_ID };

  const employees = buildLoadEmployees(count);
  const numberRefs = employees.map(e => db.doc(`${base}/employeeNumbers/${e.employeeNumber}`));
  const officeRef = db.doc(`${base}/offices/${LOAD_OFFICE_ID}`);
  const existing = await db.getAll(officeRef, ...numberRefs);
  // 前回途中で止まった同じサンプルは作り直してよい。それ以外の既存データとは重ねない
  if (existing.some(d => d.exists && d.data()!.sampleSetId !== LOAD_SET_ID)) {
    throw new HttpsError('already-exists', 'サンプルの事業所または社員番号が既存データと重複しています。上書きせず中断しました');
  }

  const now = Timestamp.now();
  const shared = { isSample: true, sampleSetId: LOAD_SET_ID, createdAt: now, updatedAt: now };
  const writes: { ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }[] = [];
  writes.push({ ref: officeRef, data: {
    ...shared, name: 'サンプル負荷テスト事業所', officeNumber: 'LOAD-001', prefectureCode: '13', insurerId: '01130012',
    address: 'テスト用住所', phone: '000-0000-0000', closingDay: 0, paymentDay: 25, paymentMonth: 'current',
    deductionMethod: 'previous', roundingRule: 'statutory', isActive: true, version: 1,
  } });
  for (const e of employees) {
    const ref = db.doc(`${base}/employees/${e.id}`);
    writes.push({ ref: numberRefs[employees.indexOf(e)], data: { ...shared, employeeId: e.id } });
    writes.push({ ref, data: {
      ...shared, employeeNumber: e.employeeNumber, lastName: e.lastName, firstName: e.firstName, lastNameKana: 'テスト', firstNameKana: 'テスト',
      birthDate: Timestamp.fromDate(new Date(`${e.birthDate}T00:00:00Z`)), gender: 'male', officeId: LOAD_OFFICE_ID, departmentId: null,
      hireDate: Timestamp.fromDate(new Date('2024-04-01T00:00:00Z')), resignationDate: null, userId: null, isActive: true, version: 1, deletedAt: null,
      sampleNote: '負荷テスト用の架空のデータ。',
    } });
    writes.push({ ref: db.doc(`${ref.path}/employments/sample-initial`), data: {
      ...shared, effectiveDate: '2024-04-01', employmentType: 'regular', weeklyHours: 40, monthlyDays: 21, baseSalary: e.remuneration,
      socialInsuranceEnrolled: true, longTermCareEnrolled: false, note: '負荷テスト用', version: 1,
    } });
    if (!e.noGrade) {
      const health = lookupGrade(HEALTH_GRADE_TABLE, e.remuneration);
      const pension = lookupGrade(PENSION_GRADE_TABLE, e.remuneration);
      writes.push({ ref: db.doc(`${ref.path}/grades/2026-09`), data: {
        ...shared, effectiveMonth: '2026-09', determinationType: 'regular', reason: '負荷テスト用（定時決定）',
        healthGradeNumber: health.gradeNumber, healthStandardRemuneration: health.standardRemuneration,
        pensionGradeNumber: pension.gradeNumber, pensionStandardRemuneration: pension.standardRemuneration,
        basisRemuneration: e.remuneration, isConfirmed: true, version: 1,
      } });
    }
  }
  writes.push({ ref: marker, data: { ...shared, employeeCount: count, officeId: LOAD_OFFICE_ID, createdBy: auth.uid } });
  writes.push({ ref: db.collection(`${base}/auditLogs`).doc(), data: { entity: 'sampleSet', entityId: LOAD_SET_ID, action: 'create', changes: { employeeCount: count }, performedBy: auth.uid, performedAt: now, version: 1 } });

  // 1回の書き込みは500件まで。目印（marker）は最後の組に入るので、途中で失敗したら同じ内容で書き直せる
  for (let i = 0; i < writes.length; i += 450) {
    const batch = db.batch();
    for (const w of writes.slice(i, i + 450)) batch.set(w.ref, w.data);
    await batch.commit();
  }
  return { created: count, alreadyExists: false, officeId: LOAD_OFFICE_ID };
}
