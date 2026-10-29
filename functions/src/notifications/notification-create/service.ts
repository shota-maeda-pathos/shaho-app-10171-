import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext } from '../../middleware/auth';
import { MutationResponse } from '../../types/response';
import { NotificationCreateInput } from './schema';

export async function createNotification(
  input: NotificationCreateInput,
  auth: AuthContext,
): Promise<MutationResponse> {
  const now = Timestamp.now();
  const ref = db.collection(`companies/${auth.companyId}/notifications`).doc();

  await ref.set({
    title: input.title,
    body: input.body,
    category: input.category,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    createdBy: auth.uid,
    createdAt: now,
    updatedAt: now,
  });

  return { success: true, id: ref.id };
}
