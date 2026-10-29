import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { db } from '../../config';
import { Timestamp } from 'firebase-admin/firestore';

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

export const seedGrades = onCall(async (request) => {
  const companyId = request.data?.companyId ?? 'company-001';
  const auth = await getAuthContext(request, companyId);
  requireRole(auth, 'admin', 'operator');

  const base = `companies/${companyId}`;
  const now = Timestamp.now();

  const empSnap = await db.collection(`${base}/employees`)
    .where('deletedAt', '==', null)
    .where('isActive', '==', true)
    .get();

  let created = 0;
  let skipped = 0;

  for (const empDoc of empSnap.docs) {
    const empData = empDoc.data();
    const hireDate: string = empData.hireDate?.toDate?.()
      ? empData.hireDate.toDate().toISOString().slice(0, 7)
      : '2026-09';

    const salariesSnap = await db.collection(`${base}/employees/${empDoc.id}/salaries`)
      .limit(1).get();

    let monthlySalary = 300000;
    if (!salariesSnap.empty) {
      monthlySalary = salariesSnap.docs[0].data().totalSalary || 300000;
    }

    const gradeRef = db.doc(`${base}/employees/${empDoc.id}/grades/${hireDate}`);
    const existing = await gradeRef.get();
    if (existing.exists) {
      skipped++;
      continue;
    }

    const health = lookupGrade(HEALTH_TABLE, monthlySalary);
    const pension = lookupGrade(PENSION_TABLE, monthlySalary);

    await gradeRef.set({
      effectiveMonth: hireDate,
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
    created++;
  }

  return {
    success: true,
    message: `等級を作成しました: ${created}件 (スキップ: ${skipped}件)`,
  };
});
