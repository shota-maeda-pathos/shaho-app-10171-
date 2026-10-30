import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config';
import { AuthContext, requireRole } from '../middleware/auth';
import { HEALTH_GRADE_TABLE, lookupGrade, PENSION_GRADE_TABLE } from '../insurance/calculator';

export const REVISION_SET_ID = 'revision-v1';
export const REVISION_OFFICE_ID = 'sample-revision-office';
/** 変動月。毎月の処理の2026年9月支給（3か月目）で「随時改定の可能性」が出る */
export const REVISION_CHANGE_MONTH = '2026-07';

interface Month { fixed: number; total: number; days?: number; confirmed?: boolean; retro?: number }

export interface RevisionSampleEmployee {
  id: string;
  employeeNumber: string;
  lastName: string;
  firstName: string;
  note: string;
  category: 'general' | 'partTimer' | 'shortTime';
  /** 今の等級を決めた報酬月額（2025年9月の定時決定）。null なら根拠を記録しない */
  gradeRemuneration: number;
  basisRemuneration: number | null;
  /** 2026年6月（変動月の前月）〜9月の給与 */
  months: [Month, Month, Month, Month];
  /** 育休（復帰後の終了時改定の確認用） */
  childcareLeave?: { start: string; end: string; childBirthDate: string };
}

const same = (fixed: number, total = fixed, days = 20): Month => ({ fixed, total, days });

/** 随時改定・終了時改定の判定の場合分けを1人ずつ用意する */
export function buildRevisionSample(): RevisionSampleEmployee[] {
  const list: Omit<RevisionSampleEmployee, 'id' | 'employeeNumber'>[] = [
    { lastName: '昇給', firstName: '一郎', note: '昇給で2等級以上上がる（対象）', category: 'general', gradeRemuneration: 300_000, basisRemuneration: 300_000,
      months: [same(300_000), same(360_000, 365_000), same(360_000, 365_000), same(360_000, 365_000)] },
    { lastName: '降給', firstName: '二郎', note: '降給で2等級以上下がる（対象）', category: 'general', gradeRemuneration: 360_000, basisRemuneration: 360_000,
      months: [same(360_000), same(290_000, 295_000), same(290_000, 295_000), same(290_000, 295_000)] },
    { lastName: '一等級', firstName: '三郎', note: '1等級しか変わらない（対象外）', category: 'general', gradeRemuneration: 300_000, basisRemuneration: 300_000,
      months: [same(300_000), same(320_000), same(320_000), same(320_000)] },
    { lastName: '逆向', firstName: '四郎', note: '昇給したが残業が減り等級は下がる（変動の向きが違うので対象外）', category: 'general', gradeRemuneration: 300_000, basisRemuneration: 300_000,
      months: [same(250_000, 300_000), same(260_000, 240_000), same(260_000, 240_000), same(260_000, 240_000)] },
    { lastName: '日数', firstName: '五郎', note: '8月の支払基礎日数が15日（対象外）', category: 'general', gradeRemuneration: 300_000, basisRemuneration: 300_000,
      months: [same(300_000), same(380_000), same(380_000, 380_000, 15), same(380_000)] },
    { lastName: '遡及', firstName: '六郎', note: '5月に遡って昇給し、7月に差額12万円を支給（差額を除いて判定）', category: 'general', gradeRemuneration: 300_000, basisRemuneration: 300_000,
      months: [same(300_000), { fixed: 360_000, total: 480_000, days: 20, retro: 120_000 }, same(360_000), same(360_000)] },
    { lastName: '上限', firstName: '七郎', note: '健保の上限の特例（1等級でも対象）。厚年は上限のまま', category: 'general', gradeRemuneration: 1_340_000, basisRemuneration: 1_340_000,
      months: [same(1_340_000), same(1_450_000), same(1_450_000), same(1_450_000)] },
    { lastName: '下限', firstName: '八郎', note: '厚年の下限の特例（従前の報酬月額の確認が要る）', category: 'general', gradeRemuneration: 80_000, basisRemuneration: null,
      months: [same(80_000), same(95_000), same(95_000), same(95_000)] },
    { lastName: '短時間', firstName: '九郎', note: '短時間労働者（11日以上で判定。12日で対象）', category: 'shortTime', gradeRemuneration: 150_000, basisRemuneration: 150_000,
      months: [same(150_000, 150_000, 12), same(200_000, 200_000, 12), same(200_000, 200_000, 12), same(200_000, 200_000, 12)] },
    { lastName: '未承認', firstName: '十郎', note: '9月の給与が未承認（判定は待ち）', category: 'general', gradeRemuneration: 300_000, basisRemuneration: 300_000,
      months: [same(300_000), same(360_000), same(360_000), { fixed: 360_000, total: 360_000, days: 20, confirmed: false }] },
    { lastName: '育休明', firstName: '花子', note: '育休を6月30日に終えて復帰。給与が1等級下がる（終了時改定の対象。随時改定は対象外）', category: 'general', gradeRemuneration: 300_000, basisRemuneration: 300_000,
      months: [{ fixed: 0, total: 0, days: 0 }, same(280_000, 280_000, 10), same(280_000), same(280_000)],
      childcareLeave: { start: '2025-07-01', end: '2026-06-30', childBirthDate: '2025-05-01' } },
  ];
  return list.map((e, i) => {
    const n = String(i + 1).padStart(4, '0');
    return { ...e, id: `sample-revision-${n}`, employeeNumber: `REV-${n}` };
  });
}

/**
 * 随時改定・終了時改定のテスト用の事業所（東京・協会けんぽ・翌月控除）と、場合分けの従業員を作る。
 * 2025年9月の定時決定の等級と、2026年6〜9月支給の承認済みの給与（10番目の人だけ9月は未承認）を入れる
 */
export async function seedRevisionSample(auth: AuthContext) {
  requireRole(auth, 'admin');
  const base = `companies/${auth.companyId}`;
  const employees = buildRevisionSample();
  const marker = db.doc(`${base}/sampleSets/${REVISION_SET_ID}`);
  if ((await marker.get()).exists) return { created: 0, alreadyExists: true, officeId: REVISION_OFFICE_ID, changeMonth: REVISION_CHANGE_MONTH };

  const numberRefs = employees.map(e => db.doc(`${base}/employeeNumbers/${e.employeeNumber}`));
  const officeRef = db.doc(`${base}/offices/${REVISION_OFFICE_ID}`);
  const existing = await db.getAll(officeRef, ...numberRefs);
  if (existing.some(d => d.exists && d.data()!.sampleSetId !== REVISION_SET_ID)) {
    throw new HttpsError('already-exists', 'サンプルの事業所または社員番号が既存データと重複しています。上書きせず中断しました');
  }

  const now = Timestamp.now();
  const ts = (date: string) => Timestamp.fromDate(new Date(`${date}T00:00:00Z`));
  const shared = { isSample: true, sampleSetId: REVISION_SET_ID, createdAt: now, updatedAt: now };
  const writes: { ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }[] = [];
  writes.push({ ref: officeRef, data: {
    ...shared, name: 'サンプル改定テスト事業所', officeNumber: 'REV-001', prefectureCode: '13', insurerId: '01130012',
    address: 'テスト用住所', phone: '000-0000-0000', closingDay: 0, paymentDay: 25, paymentMonth: 'current',
    deductionMethod: 'previous', roundingRule: 'statutory', bonusMonths: [], isActive: true, version: 1,
  } });
  const payMonths = ['2026-06', '2026-07', '2026-08', '2026-09'];
  for (const [index, e] of employees.entries()) {
    const ref = db.doc(`${base}/employees/${e.id}`);
    const female = !!e.childcareLeave;
    writes.push({ ref: numberRefs[index], data: { ...shared, employeeId: e.id } });
    writes.push({ ref, data: {
      ...shared, employeeNumber: e.employeeNumber, lastName: e.lastName, firstName: e.firstName, lastNameKana: 'テスト', firstNameKana: 'テスト',
      birthDate: ts('1990-04-01'), gender: female ? 'female' : 'male', officeId: REVISION_OFFICE_ID, departmentId: null,
      hireDate: ts('2020-04-01'), resignationDate: null, userId: null,
      insuredPersonNumber: String(700 + index + 1), isActive: true, version: 1, deletedAt: null, sampleNote: `改定テスト用の架空のデータ（${e.note}）`,
    } });
    writes.push({ ref: db.doc(`${ref.path}/employments/sample-initial`), data: {
      ...shared, effectiveDate: '2020-04-01', employmentType: e.category === 'shortTime' ? 'partTime' : 'regular',
      weeklyHours: e.category === 'shortTime' ? 25 : 40, monthlyDays: e.category === 'shortTime' ? 12 : 21, baseSalary: e.months[1].fixed,
      healthInsuranceEnrolled: true, pensionEnrolled: true, socialInsuranceEnrolled: true,
      insuredCategory: e.category, ...(e.category === 'shortTime' ? { applicabilityReason: 'specificShortTime' } : {}),
      longTermCareEnrolled: false, note: '改定テスト用', version: 1,
    } });
    const h = lookupGrade(HEALTH_GRADE_TABLE, e.gradeRemuneration);
    const p = lookupGrade(PENSION_GRADE_TABLE, e.gradeRemuneration);
    writes.push({ ref: db.doc(`${ref.path}/grades/2025-09`), data: {
      ...shared, effectiveMonth: '2025-09', determinationType: 'regular',
      healthGradeNumber: h.gradeNumber, healthStandardRemuneration: h.standardRemuneration,
      pensionGradeNumber: p.gradeNumber, pensionStandardRemuneration: p.standardRemuneration,
      basisRemuneration: e.basisRemuneration, basisMonths: null, reason: '定時決定（改定テスト用）', isConfirmed: true, version: 1,
    } });
    e.months.forEach((m, i) => {
      const confirmed = m.confirmed !== false;
      const noPay = m.total === 0;
      writes.push({ ref: db.doc(`${ref.path}/salaries/${payMonths[i]}`), data: {
        ...shared, yearMonth: payMonths[i], officeId: REVISION_OFFICE_ID, paymentBasisDays: m.days ?? 20,
        baseSalary: m.fixed, fixedAllowances: {}, variableAllowances: m.total - m.fixed - (m.retro ?? 0) > 0 ? { '残業手当': m.total - m.fixed - (m.retro ?? 0) } : {},
        totalFixedWage: m.fixed, totalVariableWage: Math.max(0, m.total - m.fixed - (m.retro ?? 0)), totalSalary: m.total, inKindAmount: 0,
        retroactivePay: m.retro ? { amount: m.retro, fromMonth: '2026-05', toMonth: '2026-06' } : null,
        ...(noPay ? { noPay: true, noPayReason: '育児休業' } : {}),
        isConfirmed: confirmed, approvalPending: false, isPublished: false, confirmedAt: confirmed ? now : null, confirmedBy: confirmed ? auth.uid : null, version: 1,
      } });
    });
    if (e.childcareLeave) {
      writes.push({ ref: db.doc(`${ref.path}/leaves/sample-childcare`), data: {
        ...shared, leaveType: 'childcare', status: 'ended', expectedStartDate: e.childcareLeave.start, expectedEndDate: e.childcareLeave.end,
        actualStartDate: e.childcareLeave.start, actualEndDate: e.childcareLeave.end, notes: `改定テスト用（子の生年月日 ${e.childcareLeave.childBirthDate}）`, version: 1,
      } });
    }
  }
  writes.push({ ref: marker, data: { ...shared, employeeCount: employees.length, officeId: REVISION_OFFICE_ID, createdBy: auth.uid } });
  writes.push({ ref: db.collection(`${base}/auditLogs`).doc(), data: { entity: 'sampleSet', entityId: REVISION_SET_ID, action: 'create', changes: { employeeCount: employees.length }, performedBy: auth.uid, performedAt: now, version: 1 } });

  // 目印（marker）は最後に書くので、途中で失敗したら同じ内容で書き直せる
  for (let i = 0; i < writes.length; i += 450) {
    const batch = db.batch();
    for (const w of writes.slice(i, i + 450)) batch.set(w.ref, w.data);
    await batch.commit();
  }
  return { created: employees.length, alreadyExists: false, officeId: REVISION_OFFICE_ID, changeMonth: REVISION_CHANGE_MONTH };
}
