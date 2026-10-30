// 賞与を大人数で確かめるための架空のサンプル（事業所・従業員・2026年度の前の賞与）。12月支給の賞与は画面からCSVで取り込む
import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config';
import { AuthContext, requireRole } from '../middleware/auth';
import { BonusPayment, summarizePayments } from './bonus-calc';

export const BONUS_SET_ID = 'bonus-v1';
export const BONUS_OFFICE_ID = 'sample-bonus-office';
/** 画面から取り込む月 */
export const BONUS_SAMPLE_MONTH = '2026-12';

const LAST = ['佐藤', '鈴木', '高橋', '田中', '伊藤', '渡辺', '山本', '中村', '小林', '加藤', '吉田', '山田', '佐々木', '山口', '松本', '井上', '木村', '林', '斎藤', '清水'];
const FIRST = ['一郎', '花子', '健太', '由美', '翔', '美咲', '大輔', '彩', '拓也', '恵', '誠', '舞', '亮', '直美', '修', '綾', '剛', '葵', '涼', '静香'];

export interface BonusSampleEmployee {
  id: string;
  employeeNumber: string;
  lastName: string;
  firstName: string;
  gender: 'male' | 'female';
  birthDate: string;
  hireDate: string;
  resignationDate: string | null;
  enrolled: boolean;
  insuredPersonNumber: string;
  /** 前の月の賞与（月→支給額・承認済みか） */
  earlier: { yearMonth: string; amount: number; confirmed: boolean }[];
  /** 12月の支給（CSVに載せる） */
  december: BonusPayment[];
  /** 育休（12月の賞与が免除になる） */
  childcareLeave: { start: string; end: string } | null;
  note: string;
}

/**
 * n人分の架空の従業員。50人ごとに次の場面を1人ずつ混ぜる（残りは7月と12月に1回ずつ）。
 * 1:同月2回 2:健保の上限に近い 3:健保・厚年の上限超え 4:年4回目 5:育休で免除 6:70歳以上 7:資格喪失月の支給
 * 8:喪失日以後の支給 9:12月は支給なし 10:現物あり 11:7月の賞与が未承認 12:社会保険の適用外
 */
export function buildBonusSample(count: number): BonusSampleEmployee[] {
  return Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    const k = n % 50;
    const base = 200_000 + ((n * 37) % 43) * 10_000;
    const summer = Math.round(base * 2 / 1000) * 1000 + (n % 3) * 500;
    const winter = Math.round(base * 2.2 / 1000) * 1000 + (n % 4) * 300;
    const earlier = k === 2 ? [{ yearMonth: '2026-07', amount: 3_500_000, confirmed: true }]
      : k === 3 ? [{ yearMonth: '2026-07', amount: 4_000_000, confirmed: true }]
      : k === 4 ? [{ yearMonth: '2026-04', amount: 100_000, confirmed: true }, { yearMonth: '2026-07', amount: summer, confirmed: true }, { yearMonth: '2026-08', amount: 100_000, confirmed: true }]
      : k === 7 || k === 8 ? []
      : [{ yearMonth: '2026-07', amount: summer, confirmed: k !== 11 }];
    const december: BonusPayment[] = k === 9 ? []
      : k === 1 ? [{ date: '2026-12-10', cash: winter, inKind: 0 }, { date: '2026-12-25', cash: 150_000, inKind: 0 }]
      : k === 2 ? [{ date: '2026-12-10', cash: 1_200_000, inKind: 0 }]
      : k === 3 ? [{ date: '2026-12-10', cash: 2_000_000, inKind: 0 }]
      : k === 10 ? [{ date: '2026-12-10', cash: winter, inKind: 30_000 }]
      : [{ date: '2026-12-10', cash: winter, inKind: 0 }];
    const year = k === 6 ? 1954 : 1960 + (n * 7) % 43;
    return {
      id: `sample-bonus-${String(n).padStart(4, '0')}`,
      employeeNumber: `BONUS-${String(n).padStart(4, '0')}`,
      lastName: LAST[i % LAST.length],
      firstName: FIRST[Math.floor(i / LAST.length) % FIRST.length],
      gender: k === 5 || n % 2 === 0 ? 'female' : 'male',
      birthDate: `${year}-${String((n * 5) % 12 + 1).padStart(2, '0')}-${String((n * 3) % 28 + 1).padStart(2, '0')}`,
      hireDate: '2024-04-01',
      resignationDate: k === 7 ? '2026-12-20' : k === 8 ? '2026-12-05' : null,
      enrolled: k !== 12,
      insuredPersonNumber: n % 100 === 0 ? '' : String(1000 + n),
      earlier, december,
      childcareLeave: k === 5 ? { start: '2026-11-01', end: '2027-03-31' } : null,
      note: ({ 1: '同じ月に2回支給（合算）', 2: '健保の年度累計が上限に近い', 3: '健保・厚年の上限を超える', 4: '年度で4回目の賞与', 5: '育休中（賞与の保険料が免除）',
        6: '70歳以上（厚年なし）', 7: '資格喪失月の支給（保険料なし・届出あり）', 8: '喪失日以後の支給（届出不要）', 9: '12月は支給なし', 10: '現物あり',
        11: '7月の賞与が未承認（年度累計が数えられない）', 12: '社会保険の適用外' } as Record<number, string>)[k] ?? '7月と12月に1回ずつ',
    };
  });
}

/** 12月支給の賞与の取込用CSV（画面の「貼り付けて取り込む」に使う） */
export function bonusSampleCsv(employees: BonusSampleEmployee[]): string {
  const lines = ['社員番号,氏名,支給日,賞与額,現物'];
  for (const e of employees) for (const p of e.december) lines.push([e.employeeNumber, `${e.lastName} ${e.firstName}`, p.date, p.cash, p.inKind].join(','));
  return lines.join('\n');
}

/**
 * 賞与のテスト用の事業所（東京・協会けんぽ・支給予定月 7・9・12月）と count 名の従業員、2026年度の前の月の賞与を作る。
 * 9月は支給予定月だが賞与がない（不支給報告書のアラートの確認用）
 */
export async function seedBonusSample(auth: AuthContext, count: number) {
  requireRole(auth, 'admin');
  const base = `companies/${auth.companyId}`;
  const employees = buildBonusSample(count);
  const csv = bonusSampleCsv(employees);
  const marker = db.doc(`${base}/sampleSets/${BONUS_SET_ID}`);
  if ((await marker.get()).exists) return { created: 0, alreadyExists: true, officeId: BONUS_OFFICE_ID, payMonth: BONUS_SAMPLE_MONTH, csv };

  const numberRefs = employees.map(e => db.doc(`${base}/employeeNumbers/${e.employeeNumber}`));
  const officeRef = db.doc(`${base}/offices/${BONUS_OFFICE_ID}`);
  const existing = await db.getAll(officeRef, ...numberRefs);
  if (existing.some(d => d.exists && d.data()!.sampleSetId !== BONUS_SET_ID)) {
    throw new HttpsError('already-exists', 'サンプルの事業所または社員番号が既存データと重複しています。上書きせず中断しました');
  }

  const now = Timestamp.now();
  const ts = (date: string) => Timestamp.fromDate(new Date(`${date}T00:00:00Z`));
  const shared = { isSample: true, sampleSetId: BONUS_SET_ID, createdAt: now, updatedAt: now };
  const writes: { ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }[] = [];
  writes.push({ ref: officeRef, data: {
    ...shared, name: 'サンプル賞与テスト事業所', officeNumber: 'BONUS-001', prefectureCode: '13', insurerId: '01130012',
    address: 'テスト用住所', phone: '000-0000-0000', closingDay: 0, paymentDay: 25, paymentMonth: 'current',
    deductionMethod: 'previous', roundingRule: 'statutory', bonusMonths: [7, 9, 12], isActive: true, version: 1,
  } });
  for (const [index, e] of employees.entries()) {
    const ref = db.doc(`${base}/employees/${e.id}`);
    writes.push({ ref: numberRefs[index], data: { ...shared, employeeId: e.id } });
    writes.push({ ref, data: {
      ...shared, employeeNumber: e.employeeNumber, lastName: e.lastName, firstName: e.firstName, lastNameKana: 'テスト', firstNameKana: 'テスト',
      birthDate: ts(e.birthDate), gender: e.gender, officeId: BONUS_OFFICE_ID, departmentId: null,
      hireDate: ts(e.hireDate), resignationDate: e.resignationDate ? ts(e.resignationDate) : null, userId: null,
      insuredPersonNumber: e.insuredPersonNumber, isActive: true, version: 1, deletedAt: null, sampleNote: `賞与テスト用の架空のデータ（${e.note}）`,
    } });
    writes.push({ ref: db.doc(`${ref.path}/employments/sample-initial`), data: {
      ...shared, effectiveDate: e.hireDate, employmentType: e.enrolled ? 'regular' : 'partTime',
      weeklyHours: e.enrolled ? 40 : 15, monthlyDays: e.enrolled ? 21 : 10, baseSalary: 250_000,
      healthInsuranceEnrolled: e.enrolled, pensionEnrolled: e.enrolled, socialInsuranceEnrolled: e.enrolled,
      insuredCategory: 'general', longTermCareEnrolled: false, note: '賞与テスト用', version: 1,
    } });
    let prior = 0;
    for (const b of e.earlier) {
      const payments = [{ date: `${b.yearMonth}-10`, cash: b.amount, inKind: 0 }];
      const s = summarizePayments(payments);
      prior += s.standard;
      writes.push({ ref: db.doc(`${ref.path}/bonuses/${b.yearMonth}`), data: {
        ...shared, yearMonth: b.yearMonth, officeId: BONUS_OFFICE_ID, payments, paymentDate: s.firstPaymentDate,
        cashAmount: s.cash, inKindAmount: 0, totalAmount: s.total, standardBonusAmount: s.standard, cumulativeBonusAmount: prior, source: 'sample',
        isConfirmed: b.confirmed, approvalPending: false, confirmedAt: b.confirmed ? now : null, confirmedBy: b.confirmed ? auth.uid : null, version: 1,
      } });
    }
    if (e.childcareLeave) {
      const leaveRef = db.doc(`${ref.path}/leaves/sample-childcare`);
      writes.push({ ref: leaveRef, data: {
        ...shared, leaveType: 'childcare', status: 'active', expectedStartDate: e.childcareLeave.start, expectedEndDate: e.childcareLeave.end,
        actualStartDate: e.childcareLeave.start, actualEndDate: null, note: '賞与テスト用（育休）', version: 1,
      } });
      writes.push({ ref: db.doc(`${ref.path}/premiumExemptions/sample-childcare`), data: {
        ...shared, exemptionType: 'childcare', leaveId: leaveRef.id, startMonth: e.childcareLeave.start.slice(0, 7), endMonth: '2027-02',
        isMonthlyExempted: true, isBonusExempted: true, status: 'active', approvedAt: now, deletedAt: null, version: 1,
      } });
    }
  }
  writes.push({ ref: marker, data: { ...shared, employeeCount: count, officeId: BONUS_OFFICE_ID, createdBy: auth.uid } });
  writes.push({ ref: db.collection(`${base}/auditLogs`).doc(), data: { entity: 'sampleSet', entityId: BONUS_SET_ID, action: 'create', changes: { employeeCount: count }, performedBy: auth.uid, performedAt: now, version: 1 } });

  // 1回の書き込みは500件まで。目印（marker）は最後の組に入るので、途中で失敗したら同じ内容で書き直せる
  for (let i = 0; i < writes.length; i += 450) {
    const batch = db.batch();
    for (const w of writes.slice(i, i + 450)) batch.set(w.ref, w.data);
    await batch.commit();
  }
  return { created: count, alreadyExists: false, officeId: BONUS_OFFICE_ID, payMonth: BONUS_SAMPLE_MONTH, csv };
}
