import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { toDateString } from '../../utils/employment';
import { todayJst } from '../../procedures/wizard';

/**
 * 退職日を過ぎた人を在籍から外す（毎朝の処理から呼ぶ）。
 * 退職を登録した時点では、退職日までは在籍中のまま残している（stillEmployedOn）。
 * 在籍中の人は会社あたり数百人なので、在籍中だけを読んで退職日はメモリで比べる（複合索引に頼らない）
 */
export async function deactivateResignedEmployees(companyId: string, today: string = todayJst()): Promise<number> {
  const snap = await db.collection(`companies/${companyId}/employees`)
    .where('isActive', '==', true).select('resignationDate', 'version', 'deletedAt').get();
  const due = snap.docs.filter((d) => {
    const resign = toDateString(d.data().resignationDate);
    return d.data().deletedAt == null && !!resign && resign < today;
  });
  const now = Timestamp.now();
  for (let i = 0; i < due.length; i += 200) {
    const batch = db.batch();
    for (const d of due.slice(i, i + 200)) {
      const version = (d.data().version ?? 1) + 1;
      batch.update(d.ref, { isActive: false, updatedAt: now, version });
      batch.set(db.collection(`companies/${companyId}/auditLogs`).doc(), {
        entity: 'employee', entityId: d.id, action: 'update',
        changes: { isActive: { from: true, to: false } },
        note: `退職日（${toDateString(d.data().resignationDate)}）を過ぎたため在籍から外す`,
        performedBy: 'system', performedAt: now, version,
      });
    }
    await batch.commit();
  }
  return due.length;
}
