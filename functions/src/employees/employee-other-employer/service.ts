import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { EmployeeDoc } from '../../types/firestore';
import { notFound } from '../../utils/errors';

/**
 * 二以上事業所勤務の登録・解除（カタログ：本システムでは対応しない。担当者が登録でき、警告を出す）。
 * 登録しても保険料の計算や届出は変えない（按分・選択事業所の届出は別途手続き）
 */
export async function setOtherEmployer(
  input: { companyId: string; employeeId: string; otherEmployer: { name: string; since: string | null; note: string } | null },
  auth: AuthContext,
) {
  const ref = db.doc(`companies/${input.companyId}/employees/${input.employeeId}`);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data()!.deletedAt !== null) throw notFound('従業員');
    const e = snap.data() as EmployeeDoc;
    requireOffice(auth, e.officeId);
    const now = Timestamp.now();
    const next = input.otherEmployer ? { ...input.otherEmployer, registeredAt: now, registeredBy: auth.uid } : null;
    tx.update(ref, { otherEmployer: next, updatedAt: now, version: e.version + 1 });
    tx.set(db.collection(`companies/${input.companyId}/auditLogs`).doc(), {
      entity: 'employee', entityId: input.employeeId, action: 'update',
      changes: { otherEmployer: { from: e.otherEmployer?.name ?? null, to: input.otherEmployer?.name ?? null } },
      performedBy: auth.uid, performedAt: now, version: e.version + 1,
    });
  });
  return { success: true };
}
