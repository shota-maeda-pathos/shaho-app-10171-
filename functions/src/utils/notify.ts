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
  /** 押したときに開く画面（種類と ID から決まらないときだけ残す。決まるものは notifications/staff/rules.ts の noticeLink） */
  link?: { route: string; queryParams?: Record<string, string> } | null;
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
    link: params.link ?? null,
    isRead: false,
    createdAt: now,
    updatedAt: now,
  });
  return ref.id;
}
