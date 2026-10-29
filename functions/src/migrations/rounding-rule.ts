import { onCall } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { db } from '../config';
import { AuthContext, getAuthContext, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validation';

const Schema = z.object({
  companyId: z.string().min(1).regex(/^[^/]+$/),
  /** true（既定）は変更せず対象だけを返す */
  dryRun: z.boolean().default(true),
});

/**
 * 旧データの端数処理ルールを法定ルール（50銭以下切捨て・50銭超切上げ）に移行する。
 * 旧画面では端数処理を選べず、事業所作成時に 'truncate' が自動で入っていたため、
 * 'truncate' と未設定の事業所を対象とする。労使協定で切捨てにしている事業所は移行後に設定し直す。
 */
export async function migrateRoundingRule(input: z.infer<typeof Schema>, auth: AuthContext) {
  const snap = await db.collection(`companies/${auth.companyId}/offices`).get();
  const targets = snap.docs.filter(d => d.data().roundingRule === 'truncate' || d.data().roundingRule == null);
  if (!input.dryRun) {
    const now = Timestamp.now();
    const batch = db.batch();
    for (const doc of targets) {
      batch.update(doc.ref, { roundingRule: 'statutory', updatedAt: now });
      batch.set(db.collection(`companies/${auth.companyId}/auditLogs`).doc(), {
        entity: 'office', entityId: doc.id, action: 'update',
        changes: { roundingRule: { from: doc.data().roundingRule ?? null, to: 'statutory' } },
        performedBy: auth.uid, performedAt: now, version: doc.data().version ?? 1,
      });
    }
    await batch.commit();
  }
  return { dryRun: input.dryRun, offices: targets.map(d => ({ id: d.id, name: d.data().name as string, from: d.data().roundingRule ?? null })) };
}

export const migrateOfficeRoundingRule = onCall(async (request) => {
  const input = validate(Schema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin');
  return migrateRoundingRule(input, auth);
});
