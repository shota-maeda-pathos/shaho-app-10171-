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
  /** 画面の旧い読み方（items と同じ） */
  notifications: NotificationItem[];
  unreadCount: number;
  hasMore: boolean;
}

type Doc = FirebaseFirestore.QueryDocumentSnapshot;

/**
 * 全員あて・事業所あて・本人あてのお知らせ（本人ポータル・お知らせ管理）。
 * スタッフ向けのお知らせ（承認など）は数が多く、新しい順に切ってから絞ると本人あてが埋もれるので、
 * 見てよい種類だけを等価条件で読み（複合索引に頼らない）、まとめて新しい順に並べる
 */
export async function listNotifications(
  input: NotificationListInput,
  auth: AuthContext,
): Promise<NotificationListResponse> {
  const base = `companies/${auth.companyId}`;
  const col = db.collection(`${base}/notifications`);
  const [all, office, mine, readSnap] = await Promise.all([
    col.where('targetType', '==', 'all').get(),
    auth.officeIds.length ? col.where('targetType', '==', 'office').get() : Promise.resolve(null),
    auth.employeeId ? col.where('targetId', '==', auth.employeeId).get() : Promise.resolve(null),
    db.collection(`${base}/notificationReads`).where('userId', '==', auth.uid).get(),
  ]);
  const readIds = new Set(readSnap.docs.map(d => d.data().notificationId));
  const seen = new Set<string>();
  const visible: Doc[] = [];
  const add = (docs: Doc[] | undefined, ok: (d: FirebaseFirestore.DocumentData) => boolean) => {
    for (const doc of docs ?? []) {
      if (seen.has(doc.id) || !ok(doc.data())) continue;
      seen.add(doc.id);
      visible.push(doc);
    }
  };
  add(all.docs, () => true);
  add(office?.docs, d => auth.officeIds.includes(d.targetId));
  add(mine?.docs, d => d.targetType === 'employee');
  const time = (d: Doc) => d.data().createdAt?.toMillis?.() ?? 0;
  visible.sort((a, b) => time(b) - time(a) || b.id.localeCompare(a.id));

  let start = 0;
  if (input.lastDocId) {
    const i = visible.findIndex(d => d.id === input.lastDocId);
    if (i < 0) throw notFound('通知の続き');
    start = i + 1;
  }
  const page = visible.slice(start, start + input.limit);
  const items: NotificationItem[] = page.map(doc => {
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

  return {
    items,
    notifications: items,
    unreadCount: visible.filter(d => !readIds.has(d.id)).length,
    hasMore: visible.length > start + input.limit,
  };
}
