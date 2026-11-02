import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../config';

export interface NotifyParams {
  companyId: string;
  title: string;
  body: string;
  category: 'approval' | 'filing' | 'leave' | 'salary' | 'system';
  targetType: string;
  targetId?: string;
  createdBy: string;
  /** スタッフ向けのお知らせを見せる事業所（担当者・承認者は自分の担当事業所のものだけ見る。管理者はすべて） */
  officeId?: string | null;
}


export async function notify(params: NotifyParams): Promise<string> {
  const now = Timestamp.now();
  const ref = db.collection(`companies/${params.companyId}/notifications`).doc();
  await ref.set({
    title: params.title,
    body: params.body,
    category: params.category,
    targetType: params.targetType,
    targetId: params.targetId ?? null,
    createdBy: params.createdBy,
    officeId: params.officeId ?? null,
    isRead: false,
    createdAt: now,
    updatedAt: now,
  });
  return ref.id;
}
