import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../../config';
import { AuthContext, requireRole } from '../../middleware/auth';
import { samplePlayers, sampleSources } from './data';

export async function seedTigersSamples(auth: AuthContext) {
  requireRole(auth, 'admin');
  if (auth.companyId !== 'company-001' || auth.uid !== 'MJNjXeCfoYaohOgT5G4EZQf8URE3') {
    throw new HttpsError('permission-denied', 'このサンプル登録は指定の管理者・会社専用です');
  }
  const base = `companies/${auth.companyId}`;
  const marker = db.doc(`${base}/sampleSets/tigers-v1`);
  return db.runTransaction(async tx => {
    if ((await tx.get(marker)).exists) return { created: 0, total: samplePlayers.length, alreadyExists: true };
    const now = Timestamp.now();
    const shared = { isSample: true, sampleSetId: 'tigers-v1', createdAt: now, updatedAt: now };
    const entries: { path: string; data: Record<string, unknown> }[] = [];
    const add = (path: string, data: Record<string, unknown>) => entries.push({ path: `${base}/${path}`, data: { ...shared, ...data } });
    const officeId = 'sample-tigers-office';
    add(`offices/${officeId}`, { name: 'サンプル甲子園事業所', officeNumber: 'TEST-001', prefectureCode: '28', address: 'テスト用住所', phone: '000-0000-0000', closingDay: 0, paymentDay: 25, paymentMonth: 'current', deductionMethod: 'current', roundingRule: 'statutory', isActive: true });
    add('departments/sample-tigers-team', { name: 'サンプル営業部', officeId, parentId: null, sortOrder: 1, isActive: true });
    for (const player of samplePlayers) {
      const id = `sample-tigers-${String(player.n).padStart(2, '0')}`;
      const employeeNumber = `TEST-${String(player.n).padStart(3, '0')}`;
      const remuneration = player.n === 6 ? 500000 : 300000;
      const hireDate = Timestamp.fromDate(new Date('2026-04-01T00:00:00Z'));
      add(`employeeNumbers/${employeeNumber}`, { employeeId: id });
      add(`employees/${id}`, { employeeNumber, lastName: player.last, firstName: player.first, lastNameKana: player.kanaLast, firstNameKana: player.kanaFirst, birthDate: Timestamp.fromDate(new Date(player.birth + 'T00:00:00Z')), gender: 'male', officeId, departmentId: 'sample-tigers-team', hireDate, resignationDate: null, userId: null, email: `test${player.n}@example.com`, isActive: true, version: 1, deletedAt: null, sampleNote: '氏名・生年月日のみ公開情報。その他は架空の検証用データ。', birthDateSources: sampleSources });
      add(`employees/${id}/employments/sample-initial`, { effectiveDate: '2026-04-01', employmentType: 'regular', weeklyHours: 40, monthlyDays: 20, baseSalary: remuneration, socialInsuranceEnrolled: true, longTermCareEnrolled: player.n === 6, note: '検証用。実際の雇用・報酬情報ではありません。', version: 1 });
      add(`employees/${id}/grades/2026-04`, { effectiveMonth: '2026-04', healthGradeNumber: player.n === 6 ? 32 : 22, pensionGradeNumber: player.n === 6 ? 30 : 20, healthStandardRemuneration: remuneration, pensionStandardRemuneration: remuneration, determinationType: 'initial', reason: 'テスト専用の等級・標準報酬', version: 1 });
      for (const month of ['2026-04', '2026-05', '2026-06', '2026-10']) {
        add(`employees/${id}/salaries/${month}`, { yearMonth: month, officeId, paymentBasisDays: 20, baseSalary: remuneration, fixedAllowances: {}, variableAllowances: {}, totalFixedWage: remuneration, totalVariableWage: 0, totalSalary: remuneration, isConfirmed: false, confirmedAt: null, confirmedBy: null, version: 1 });
      }
    }
    const refs = entries.map(entry => db.doc(entry.path));
    const existing = await tx.getAll(...refs);
    if (existing.some(doc => doc.exists)) throw new HttpsError('already-exists', 'サンプルIDまたは社員番号が既存データと重複しています。上書きせず中断しました');
    const companyRef = db.doc(base);
    const company = await tx.get(companyRef);
    // 料率はここで作らない（架空の料率が事業所の都道府県の料率より優先されてしまうため）。協会けんぽの料率は料率の画面から取り込む
    if (!company.exists) tx.create(companyRef, { ...shared, name: 'サンプル株式会社タイガース', representativeName: '金本 知憲', address: 'テスト用住所', email: 'sample-company@example.com' });
    refs.forEach((ref, i) => tx.create(ref, entries[i].data));
    tx.create(marker, { ...shared, employeeCount: samplePlayers.length, createdBy: auth.uid });
    tx.create(db.collection(`${base}/auditLogs`).doc(), { entity: 'sampleSet', entityId: 'tigers-v1', action: 'create', changes: { employeeCount: samplePlayers.length }, performedBy: auth.uid, performedAt: now, version: 1 });
    return { created: samplePlayers.length, total: samplePlayers.length, alreadyExists: false };
  });
}
