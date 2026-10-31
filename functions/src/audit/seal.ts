import { createHash } from 'crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { db } from '../config';
import { stableStringify } from '../utils/hash';

/**
 * 監査ログの改ざん防止（カタログ14章）。書かれた順に通し番号（seq）を振り、
 * 1つ前の記録の指紋（prevHash）と自分の中身から指紋（hash）を作ってつなぐ。
 * どれか1件でも書き換え・削除されると、そこから先の指紋が合わなくなる。
 * 記録を書く側（各関数）は今までどおり auditLogs に書くだけでよい
 */

/** 指紋＝ SHA-256（1つ前の指紋＋通し番号＋中身＋氏名・IP） */
const NOT_HASHED = ['seq', 'prevHash', 'hash', 'sealedAt'];

export function chainHash(prevHash: string, seq: number, data: Record<string, unknown>): string {
  const content = {
    seq,
    body: Object.fromEntries(Object.entries(data).filter(([k]) => !NOT_HASHED.includes(k))),
  };
  return createHash('sha256').update(prevHash).update(stableStringify(content)).digest('hex');
}

export const auditLogSeal = onDocumentCreated(
  // 1件ずつ順に封をする（通し番号の取り合いを避ける）
  { document: 'companies/{companyId}/auditLogs/{logId}', maxInstances: 1, concurrency: 1, retry: true },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const companyId = event.params.companyId;
    const data = snap.data();
    if (typeof data.seq === 'number') return;

    // 氏名と IP を足す（IP を書いていない記録は、その人の最後に使ったセッションの IP）
    const extra: Record<string, unknown> = {};
    const uid = typeof data.performedBy === 'string' ? data.performedBy : null;
    if (uid && uid !== 'anonymous' && !data.performedByName) {
      const user = await db.doc(`companies/${companyId}/users/${uid}`).get();
      extra.performedByName = user.data()?.displayName ?? null;
    }
    if (uid && uid !== 'anonymous' && !data.ip) {
      const sessions = await db.collection(`companies/${companyId}/sessions`).where('uid', '==', uid).get();
      const latest = sessions.docs
        .map((d) => d.data())
        .sort((a, b) => (b.lastActiveAt as Timestamp).toMillis() - (a.lastActiveAt as Timestamp).toMillis())[0];
      if (latest?.ip) {
        extra.ip = latest.ip;
        extra.ipSource = 'session';
      }
    }

    const metaRef = db.doc(`companies/${companyId}/auditMeta/chain`);
    await db.runTransaction(async (tx) => {
      const [meta, current] = await Promise.all([tx.get(metaRef), tx.get(snap.ref)]);
      if (typeof current.data()?.seq === 'number') return;
      const seq = (meta.data()?.seq ?? 0) + 1;
      const prevHash: string = meta.data()?.lastHash ?? '';
      const body = { ...current.data(), ...extra };
      const hash = chainHash(prevHash, seq, body);
      tx.update(snap.ref, { ...extra, seq, prevHash, hash, sealedAt: Timestamp.now() });
      tx.set(metaRef, { seq, lastHash: hash, lastLogId: snap.id, updatedAt: Timestamp.now() });
    });
  },
);
