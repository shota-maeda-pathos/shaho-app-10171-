import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext } from '../../middleware/auth';
import { NotificationMarkReadInput } from './schema';

export async function markNotificationsRead(
  input: NotificationMarkReadInput,
  auth: AuthContext,
): Promise<{ success: true; markedCount: number }> {
  const base = `companies/${auth.companyId}/notificationReads`;
  const batch = db.batch();
  const now = Timestamp.now();
  let count = 0;

  for (const notificationId of input.notificationIds) {
    const id = `${auth.uid}_${notificationId}`;
    const ref = db.doc(`${base}/${id}`);
    batch.set(ref, {
      userId: auth.uid,
      notificationId,
      readAt: now,
    }, { merge: true });
    count++;
  }

  await batch.commit();
  return { success: true, markedCount: count };
}
