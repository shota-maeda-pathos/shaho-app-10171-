import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../config';
import type { AuthContext } from '../middleware/auth';

/**
 * 見た・出したという操作（PDF出力・CSV出力・検索など）を監査ログに残す（カタログ14章）。
 * 更新の記録は各関数のトランザクションの中で書いている。氏名・IP・通し番号は auditLogSeal が足す
 */
export async function auditAccess(
  auth: AuthContext,
  entity: string,
  entityId: string,
  action: string,
  changes: Record<string, unknown> = {},
): Promise<void> {
  const clean = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));
  await db.collection(`companies/${auth.companyId}/auditLogs`).add({
    entity,
    entityId,
    action,
    changes: clean,
    performedBy: auth.uid,
    performedAt: Timestamp.now(),
    version: 0,
  });
}
