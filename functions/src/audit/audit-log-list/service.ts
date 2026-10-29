import { db } from '../../config';
import { AuthContext } from '../../middleware/auth';
import { AuditLogListInput } from './schema';

interface AuditLogItem {
  id: string;
  action: string;
  targetPath: string;
  actorUid: string;
  actorName: string;
  timestamp: string;
  details: Record<string, unknown>;
}

export interface AuditLogListResponse {
  items: AuditLogItem[];
  hasMore: boolean;
  lastDocId?: string;
}

export async function listAuditLogs(
  input: AuditLogListInput,
  auth: AuthContext,
): Promise<AuditLogListResponse> {
  const effectiveLimit = input.limit ?? 30;

  let query: FirebaseFirestore.Query = db
    .collection(`companies/${auth.companyId}/auditLogs`)
    .orderBy('timestamp', 'desc');

  if (input.action) {
    query = query.where('action', '==', input.action);
  }
  if (input.actorUid) {
    query = query.where('actorUid', '==', input.actorUid);
  }
  if (input.lastDocId) {
    const lastDoc = await db
      .doc(`companies/${auth.companyId}/auditLogs/${input.lastDocId}`)
      .get();
    if (lastDoc.exists) {
      query = query.startAfter(lastDoc);
    }
  }

  query = query.limit(effectiveLimit + 1);
  const snap = await query.get();

  const hasMore = snap.docs.length > effectiveLimit;
  const docs = hasMore ? snap.docs.slice(0, effectiveLimit) : snap.docs;

  const items: AuditLogItem[] = docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      action: data.action,
      targetPath: data.targetPath ?? '',
      actorUid: data.actorUid,
      actorName: data.actorName ?? '',
      timestamp: data.timestamp?.toDate?.()?.toISOString?.() ?? '',
      details: data.details ?? {},
    };
  });

  return {
    items,
    hasMore,
    lastDocId: docs.length > 0 ? docs[docs.length - 1].id : undefined,
  };
}
