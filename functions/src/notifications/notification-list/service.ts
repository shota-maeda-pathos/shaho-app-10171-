import { db } from '../../config';
import { AuthContext } from '../../middleware/auth';
import { notFound } from '../../utils/errors';
import { NotificationListInput } from './schema';

export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  category: string;
  isRead: boolean;
  createdAt: string;
}

export interface NotificationListResponse {
  items: NotificationItem[];
  unreadCount: number;
  hasMore: boolean;
}

export async function listNotifications(
  input: NotificationListInput,
  auth: AuthContext,
): Promise<NotificationListResponse> {
  const base = `companies/${auth.companyId}`;

  let query: FirebaseFirestore.Query = db
    .collection(`${base}/notifications`)
    .orderBy('createdAt', 'desc');

  if (input.lastDocId) {
    const cursor = await db.doc(`${base}/notifications/${input.lastDocId}`).get();
    if (!cursor.exists) throw notFound('通知の続き');
    query = query.startAfter(cursor);
  }

  const snap = await query.limit(input.limit + 1).get();
  const page = snap.docs.slice(0, input.limit);

  const readSnap = await db
    .collection(`${base}/notificationReads`)
    .where('userId', '==', auth.uid)
    .get();
  const readIds = new Set(readSnap.docs.map(d => d.data().notificationId));

  const items: NotificationItem[] = page
    .filter(doc => {
      const d = doc.data();
      if (d.targetType === 'all') return true;
      if (d.targetType === 'office') return auth.officeIds.includes(d.targetId);
      if (d.targetType === 'employee') return d.targetId === auth.employeeId;
      return false;
    })
    .map(doc => {
      const d = doc.data();
      return {
        id: doc.id,
        title: d.title,
        body: d.body,
        category: d.category ?? 'info',
        isRead: readIds.has(doc.id),
        createdAt: d.createdAt?.toDate?.()?.toISOString?.() ?? '',
      };
    });

  const totalUnreadSnap = await db
    .collection(`${base}/notifications`)
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get();

  const unreadCount = totalUnreadSnap.docs.filter(doc => {
    const d = doc.data();
    const visible = d.targetType === 'all'
      || (d.targetType === 'office' && auth.officeIds.includes(d.targetId))
      || (d.targetType === 'employee' && d.targetId === auth.employeeId);
    return visible && !readIds.has(doc.id);
  }).length;

  return {
    items,
    unreadCount,
    hasMore: snap.docs.length > input.limit,
  };
}
