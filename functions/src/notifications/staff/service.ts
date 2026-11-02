import { db } from '../../config';
import { AuthContext } from '../../middleware/auth';
import { staffCanSee } from './rules';

export interface StaffNotice {
  id: string;
  title: string;
  body: string;
  category: string;
  isRead: boolean;
  createdAt: string;
}

/** スタッフ向けのお知らせの新しいもの（直近200件から、見せてよいものを limit 件） */
export async function listStaffNotifications(auth: AuthContext, limit: number): Promise<{ items: StaffNotice[]; unread: number }> {
  const base = `companies/${auth.companyId}`;
  const [snap, reads] = await Promise.all([
    db.collection(`${base}/notifications`).orderBy('createdAt', 'desc').limit(200).get(),
    db.collection(`${base}/notificationReads`).where('userId', '==', auth.uid).get(),
  ]);
  const readIds = new Set(reads.docs.map(d => d.data().notificationId as string));
  const visible = snap.docs.filter(d => staffCanSee(d.data(), auth));
  const items = visible.slice(0, limit).map(d => {
    const n = d.data();
    return {
      id: d.id, title: String(n.title ?? ''), body: String(n.body ?? ''), category: String(n.category ?? 'system'),
      isRead: readIds.has(d.id), createdAt: n.createdAt?.toDate?.()?.toISOString?.() ?? '',
    };
  });
  return { items, unread: visible.filter(d => !readIds.has(d.id)).length };
}
