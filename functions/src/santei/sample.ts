// 算定基礎届を大人数で確かめるための架空のサンプル（事業所・従業員・2026年4〜6月支給の承認済みの給与）
import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config';
import { AuthContext, requireRole } from '../middleware/auth';
import { HEALTH_GRADE_TABLE, PENSION_GRADE_TABLE, lookupGrade } from '../insurance/calculator';

export const SANTEI_SET_ID = 'santei-v1';
export const SANTEI_OFFICE_ID = 'sample-santei-office';
export const SANTEI_SAMPLE_YEAR = 2026;

const LAST = ['佐藤', '鈴木', '高橋', '田中', '伊藤', '渡辺', '山本', '中村', '小林', '加藤', '吉田', '山田', '佐々木', '山口', '松本', '井上', '木村', '林', '斎藤', '清水'];
const FIRST = ['一郎', '花子', '健太', '由美', '翔', '美咲', '大輔', '彩', '拓也', '恵', '誠', '舞', '亮', '直美', '修', '綾', '剛', '葵', '涼', '静香'];

export interface SanteiSampleMonth { yearMonth: string; days: number; base: number; overtime: number; confirmed: boolean; retroactive: number }

export interface SanteiSampleEmployee {
  id: string;
  employeeNumber: string;
  lastName: string;
  firstName: string;
  gender: 'male' | 'female';
  birthDate: string;
  hireDate: string;
  resignationDate: string | null;
  insuredCategory: 'general' | 'partTimer' | 'shortTime';
  /** 今の等級の根拠にした報酬（null なら等級なし） */
  gradeRemuneration: number | null;
  /** 7〜9月に随時改定の等級がある */
  occasionalRevision: boolean;
  months: SanteiSampleMonth[];
  /** どの場面を確かめるための人か */
  note: string;
}

/**
 * n人分の架空の従業員。50人ごとに次の場面を1人ずつ混ぜる（残りは等級が上がる・下がる・変わらない人）。
 * 1:6月取得 2:随時改定予定 3:6月の給与が未承認 4:給与なし（無給休職） 5:日数不足 6:パート15日 7:短時間11日
 * 8:5月だけ日数不足 9:6月末退職 10:5月取得 11:遡及支払あり 12:70歳以上
 */
export function buildSanteiSample(count: number): SanteiSampleEmployee[] {
  const y = SANTEI_SAMPLE_YEAR;
  return Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    const k = n % 50;
    const base = 180_000 + ((n * 37) % 43) * 10_000;
    // 7人に1人は大きく昇給、11人に1人は降給（等級が変わる人）。ほかは残業代だけ少し動く
    const salaryBase = n % 7 === 0 ? Math.round(base * 1.15 / 1000) * 1000 : n % 11 === 0 ? Math.round(base * 0.88 / 1000) * 1000 : base;
    const days: [number, number, number] =
      k === 5 ? [10, 12, 14] : k === 6 ? [16, 15, 16] : k === 7 ? [12, 11, 9] : k === 8 ? [30, 15, 30] : [30, 31, 30];
    const monthNumbers = k === 10 ? [5, 6] : [4, 5, 6];
    const months: SanteiSampleMonth[] = k === 1 || k === 4 ? [] : monthNumbers.map(m => {
      const scale = k === 5 || k === 7 ? 0.5 : k === 6 ? 0.6 : 1;
      return {
        yearMonth: `${y}-${String(m).padStart(2, '0')}`,
        days: days[m - 4],
        base: Math.round(salaryBase * scale / 1000) * 1000,
        overtime: k === 6 || k === 7 ? 0 : ((n * m) % 5) * 2_000,
        confirmed: !(k === 3 && m === 6),
        retroactive: k === 11 && m === 6 ? 30_000 : 0,
      };
    });
    const year = k === 12 ? 1953 : 1960 + (n * 7) % 43;
    const month = (n * 5) % 12 + 1;
    const day = (n * 3) % 28 + 1;
    return {
      id: `sample-santei-${String(n).padStart(4, '0')}`,
      employeeNumber: `SANTEI-${String(n).padStart(4, '0')}`,
      lastName: LAST[i % LAST.length],
      firstName: FIRST[Math.floor(i / LAST.length) % FIRST.length],
      gender: n % 2 ? 'male' : 'female',
      birthDate: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      hireDate: k === 1 ? `${y}-06-15` : k === 10 ? `${y}-05-01` : '2024-04-01',
      resignationDate: k === 9 ? `${y}-06-29` : null,
      insuredCategory: k === 6 ? 'partTimer' : k === 7 ? 'shortTime' : 'general',
      gradeRemuneration: n % 150 === 0 || k === 1 ? null : k === 5 || k === 7 ? Math.round(base * 0.5 / 1000) * 1000 : k === 6 ? Math.round(base * 0.6 / 1000) * 1000 : base,
      occasionalRevision: k === 2,
      months,
      note: ({ 1: '6月1日以降の資格取得（除外）', 2: '7〜9月の随時改定予定（除外）', 3: '6月の給与が未承認（保留）', 4: '4〜6月の給与なし（保留）',
        5: '支払基礎日数の不足（対応要）', 6: 'パートの15日特例', 7: '短時間労働者の11日基準', 8: '5月だけ日数不足（2か月の平均）',
        9: '6月末に退職（除外）', 10: '5月の資格取得（5・6月の平均）', 11: '遡及支払あり（修正平均額）', 12: '70歳以上' } as Record<number, string>)[k]
        ?? (n % 150 === 0 ? '今の等級なし' : n % 7 === 0 ? '昇給（等級が上がる）' : n % 11 === 0 ? '降給（等級が下がる）' : '等級が変わらない'),
    };
  });
}

/**
 * 算定のテスト用の事業所（東京・協会けんぽ・翌月控除）と count 名の従業員、2026年4〜6月支給の給与を作る。
 * 毎月の処理のサンプル（sample-load-office）とは別の事業所にし、承認済みの保険料と食い違わないようにする。
 */
export async function seedSanteiSample(auth: AuthContext, count: number) {
  requireRole(auth, 'admin');
  const base = `companies/${auth.companyId}`;
  const marker = db.doc(`${base}/sampleSets/${SANTEI_SET_ID}`);
  if ((await marker.get()).exists) return { created: 0, alreadyExists: true, officeId: SANTEI_OFFICE_ID };

  const employees = buildSanteiSample(count);
  const numberRefs = employees.map(e => db.doc(`${base}/employeeNumbers/${e.employeeNumber}`));
  const officeRef = db.doc(`${base}/offices/${SANTEI_OFFICE_ID}`);
  const existing = await db.getAll(officeRef, ...numberRefs);
  if (existing.some(d => d.exists && d.data()!.sampleSetId !== SANTEI_SET_ID)) {
    throw new HttpsError('already-exists', 'サンプルの事業所または社員番号が既存データと重複しています。上書きせず中断しました');
  }

  const now = Timestamp.now();
  const ts = (date: string) => Timestamp.fromDate(new Date(`${date}T00:00:00Z`));
  const shared = { isSample: true, sampleSetId: SANTEI_SET_ID, createdAt: now, updatedAt: now };
  const writes: { ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }[] = [];
  writes.push({ ref: officeRef, data: {
    ...shared, name: 'サンプル算定テスト事業所', officeNumber: 'SANTEI-001', prefectureCode: '13', insurerId: '01130012',
    address: 'テスト用住所', phone: '000-0000-0000', closingDay: 0, paymentDay: 25, paymentMonth: 'current',
    deductionMethod: 'previous', roundingRule: 'statutory', isActive: true, version: 1,
  } });
  for (const [index, e] of employees.entries()) {
    const ref = db.doc(`${base}/employees/${e.id}`);
    writes.push({ ref: numberRefs[index], data: { ...shared, employeeId: e.id } });
    writes.push({ ref, data: {
      ...shared, employeeNumber: e.employeeNumber, lastName: e.lastName, firstName: e.firstName, lastNameKana: 'テスト', firstNameKana: 'テスト',
      birthDate: ts(e.birthDate), gender: e.gender, officeId: SANTEI_OFFICE_ID, departmentId: null,
      hireDate: ts(e.hireDate), resignationDate: e.resignationDate ? ts(e.resignationDate) : null, userId: null,
      isActive: !e.resignationDate, version: 1, deletedAt: null, sampleNote: `算定テスト用の架空のデータ（${e.note}）`,
    } });
    writes.push({ ref: db.doc(`${ref.path}/employments/sample-initial`), data: {
      ...shared, effectiveDate: e.hireDate, employmentType: e.insuredCategory === 'general' ? 'regular' : 'partTime',
      weeklyHours: e.insuredCategory === 'general' ? 40 : e.insuredCategory === 'partTimer' ? 32 : 22, monthlyDays: 21,
      baseSalary: e.months[0]?.base ?? 0, healthInsuranceEnrolled: true, pensionEnrolled: true, socialInsuranceEnrolled: true,
      insuredCategory: e.insuredCategory, longTermCareEnrolled: false, note: '算定テスト用', version: 1,
    } });
    if (e.gradeRemuneration !== null) {
      const health = lookupGrade(HEALTH_GRADE_TABLE, e.gradeRemuneration);
      const pension = lookupGrade(PENSION_GRADE_TABLE, e.gradeRemuneration);
      writes.push({ ref: db.doc(`${ref.path}/grades/2025-09`), data: {
        ...shared, effectiveMonth: '2025-09', determinationType: 'regular', reason: '算定テスト用（前年の定時決定）',
        healthGradeNumber: health.gradeNumber, healthStandardRemuneration: health.standardRemuneration,
        pensionGradeNumber: pension.gradeNumber, pensionStandardRemuneration: pension.standardRemuneration,
        basisRemuneration: e.gradeRemuneration, isConfirmed: true, version: 1,
      } });
    }
    if (e.occasionalRevision) {
      const raised = Math.round((e.gradeRemuneration ?? 300_000) * 1.3 / 1000) * 1000;
      const health = lookupGrade(HEALTH_GRADE_TABLE, raised);
      const pension = lookupGrade(PENSION_GRADE_TABLE, raised);
      writes.push({ ref: db.doc(`${ref.path}/grades/${SANTEI_SAMPLE_YEAR}-08`), data: {
        ...shared, effectiveMonth: `${SANTEI_SAMPLE_YEAR}-08`, determinationType: 'occasional', reason: '算定テスト用（4月の昇給による随時改定）',
        healthGradeNumber: health.gradeNumber, healthStandardRemuneration: health.standardRemuneration,
        pensionGradeNumber: pension.gradeNumber, pensionStandardRemuneration: pension.standardRemuneration,
        basisRemuneration: raised, isConfirmed: true, version: 1,
      } });
    }
    for (const m of e.months) {
      const variable = m.overtime ? { '残業手当': m.overtime } : {};
      writes.push({ ref: db.doc(`${ref.path}/salaries/${m.yearMonth}`), data: {
        ...shared, yearMonth: m.yearMonth, officeId: SANTEI_OFFICE_ID, paymentBasisDays: m.days,
        baseSalary: m.base + m.retroactive, fixedAllowances: {}, variableAllowances: variable,
        totalFixedWage: m.base + m.retroactive, totalVariableWage: m.overtime, totalSalary: m.base + m.retroactive + m.overtime,
        inKindAmount: 0, retroactivePay: m.retroactive ? { amount: m.retroactive, fromMonth: `${SANTEI_SAMPLE_YEAR}-04`, toMonth: `${SANTEI_SAMPLE_YEAR}-05` } : null,
        noPay: false, noPayReason: null, source: 'sample',
        isConfirmed: m.confirmed, approvalPending: false, confirmedAt: m.confirmed ? now : null, confirmedBy: m.confirmed ? auth.uid : null, version: 1,
      } });
    }
  }
  writes.push({ ref: marker, data: { ...shared, employeeCount: count, officeId: SANTEI_OFFICE_ID, createdBy: auth.uid } });
  writes.push({ ref: db.collection(`${base}/auditLogs`).doc(), data: { entity: 'sampleSet', entityId: SANTEI_SET_ID, action: 'create', changes: { employeeCount: count }, performedBy: auth.uid, performedAt: now, version: 1 } });

  // 1回の書き込みは500件まで。目印（marker）は最後の組に入るので、途中で失敗したら同じ内容で書き直せる
  for (let i = 0; i < writes.length; i += 450) {
    const batch = db.batch();
    for (const w of writes.slice(i, i + 450)) batch.set(w.ref, w.data);
    await batch.commit();
  }
  return { created: count, alreadyExists: false, officeId: SANTEI_OFFICE_ID };
}
