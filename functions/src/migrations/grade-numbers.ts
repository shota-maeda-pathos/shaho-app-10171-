import { onCall } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { db } from '../config';
import { AuthContext, getAuthContext, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { HEALTH_GRADE_TABLE, PENSION_GRADE_TABLE } from '../insurance/calculator';
import { GradeTableEntry } from '../types/firestore';
import { mapConcurrent } from '../utils/parallel';

const Schema = z.object({
  companyId: z.string().min(1).regex(/^[^/]+$/),
  /** 事業所を指定するとその事業所の従業員だけ（省略は会社の全員） */
  officeId: z.string().regex(/^[^/]+$/).optional(),
  /** true（既定）は変更せず、直す対象だけを返す */
  dryRun: z.boolean().default(true),
});

/** 標準報酬月額から、公式の等級表の等級番号を引く（表にない額は null） */
export function gradeNumberFor(table: GradeTableEntry[], standardRemuneration: unknown): number | null {
  return typeof standardRemuneration === 'number'
    ? table.find(g => g.standardRemuneration === standardRemuneration)?.gradeNumber ?? null
    : null;
}

/** 文書の等級番号が標準報酬月額と食い違っていれば、正しい番号を返す（直すものがなければ null） */
export function gradeNumberFix(d: Record<string, unknown>): { healthGradeNumber?: number; pensionGradeNumber?: number } | null {
  const fix: { healthGradeNumber?: number; pensionGradeNumber?: number } = {};
  const h = gradeNumberFor(HEALTH_GRADE_TABLE, d.healthStandardRemuneration);
  const p = gradeNumberFor(PENSION_GRADE_TABLE, d.pensionStandardRemuneration);
  if (h !== null && d.healthGradeNumber !== h) fix.healthGradeNumber = h;
  if (p !== null && d.pensionGradeNumber !== p) fix.pensionGradeNumber = p;
  return Object.keys(fix).length ? fix : null;
}

/**
 * 等級番号を標準報酬月額から公式の等級表で引き直す（テストデータで番号だけがずれていたため）。
 * 等級（grades）と、計算のときに写した毎月の保険料（monthlyInsurance）の番号だけを直し、金額・標準報酬月額・版は変えない
 */
export async function fixGradeNumbers(input: z.infer<typeof Schema>, auth: AuthContext) {
  let q: FirebaseFirestore.Query = db.collection(`companies/${auth.companyId}/employees`).where('deletedAt', '==', null);
  if (input.officeId) q = q.where('officeId', '==', input.officeId);
  const employees = (await q.get()).docs;
  const found = await mapConcurrent(employees, 20, async e => {
    const [grades, premiums] = await Promise.all([e.ref.collection('grades').get(), e.ref.collection('monthlyInsurance').get()]);
    return [...grades.docs, ...premiums.docs]
      .map(d => ({ ref: d.ref, data: d.data(), fix: gradeNumberFix(d.data()) }))
      .filter(x => x.fix)
      .map(x => ({ ...x, employeeNumber: e.data().employeeNumber as string, name: `${e.data().lastName} ${e.data().firstName}` }));
  });
  const targets = found.flat();
  if (!input.dryRun && targets.length) {
    const now = Timestamp.now();
    for (let i = 0; i < targets.length; i += 200) {
      const batch = db.batch();
      for (const t of targets.slice(i, i + 200)) {
        batch.update(t.ref, { ...t.fix });
        batch.set(db.collection(`companies/${auth.companyId}/auditLogs`).doc(), {
          entity: t.ref.parent.id === 'grades' ? 'grade' : 'monthlyInsurance', entityId: t.ref.path, action: 'update',
          changes: Object.fromEntries(Object.entries(t.fix!).map(([k, v]) => [k, { from: t.data[k] ?? null, to: v }])),
          note: '等級番号を標準報酬月額から公式の等級表で引き直した（金額は変えない）',
          performedBy: auth.uid, performedAt: now, version: (t.data.version as number | undefined) ?? 1,
        });
      }
      await batch.commit();
    }
  }
  return {
    dryRun: input.dryRun,
    count: targets.length,
    items: targets.slice(0, 200).map(t => ({
      employeeNumber: t.employeeNumber, name: t.name, kind: t.ref.parent.id, id: t.ref.id,
      health: [t.data.healthStandardRemuneration, t.data.healthGradeNumber, t.fix!.healthGradeNumber ?? t.data.healthGradeNumber],
      pension: [t.data.pensionStandardRemuneration, t.data.pensionGradeNumber, t.fix!.pensionGradeNumber ?? t.data.pensionGradeNumber],
    })),
  };
}

export const migrateGradeNumbers = onCall({ timeoutSeconds: 300, memory: '512MiB', maxInstances: 1 }, async (request) => {
  const input = validate(Schema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin');
  return fixGradeNumbers(input, auth);
});
