import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../../config';
import { AuthContext } from '../../middleware/auth';
import { OfficeDoc } from '../../types/firestore';
import { invalidArg, notFound } from '../../utils/errors';

/**
 * 事業所の廃止（カタログ1章 事業所ライフサイクル）。在籍している従業員が0人で、進行中の手続きがないときだけ廃止できる。
 * 消さずに残し（論理削除）、過去の保険料・届出からは見られる。選択肢（有効な事業所の一覧）からは外れる
 */
export async function abolishOffice(input: { companyId: string; officeId: string; abolishedOn: string; expectedVersion: number }, auth: AuthContext) {
  const base = `companies/${auth.companyId}`;
  const ref = db.doc(`${base}/offices/${input.officeId}`);
  const [employees, procedures] = await Promise.all([
    db.collection(`${base}/employees`).where('officeId', '==', input.officeId).where('deletedAt', '==', null).get(),
    db.collection(`${base}/procedures`).where('officeId', '==', input.officeId).where('status', '==', 'in_progress').get(),
  ]);
  const active = employees.docs.filter(d => d.data().isActive !== false);
  if (active.length) throw invalidArg(`在籍している従業員が${active.length}人います（例：${active.slice(0, 3).map(d => `${d.data().lastName ?? ''} ${d.data().firstName ?? ''}`.trim()).join('、')}）。異動か退職の手続きを済ませてから廃止してください`);
  const open = procedures.docs.filter(d => d.data().deletedAt == null);
  if (open.length) throw invalidArg(`進行中の手続きが${open.length}件あります（例：${open.slice(0, 3).map(d => d.data().title).join('、')}）。済ませるか取り消してから廃止してください`);

  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw notFound('事業所');
    const o = snap.data() as OfficeDoc;
    if ((o.version ?? 1) !== input.expectedVersion) throw new HttpsError('aborted', '事業所が更新されています。画面を読み込み直してください');
    if (o.abolishedOn) throw invalidArg('この事業所は廃止済みです');
    const now = Timestamp.now();
    tx.update(ref, { isActive: false, abolishedOn: input.abolishedOn, abolishedBy: auth.uid, version: (o.version ?? 1) + 1, updatedAt: now });
    tx.set(db.collection(`${base}/auditLogs`).doc(), {
      entity: 'office', entityId: input.officeId, action: 'abolish',
      changes: { isActive: { from: o.isActive, to: false }, abolishedOn: { from: null, to: input.abolishedOn }, retiredEmployees: employees.size },
      performedBy: auth.uid, performedAt: now, version: (o.version ?? 1) + 1,
    });
  });
  return { success: true, id: input.officeId };
}
