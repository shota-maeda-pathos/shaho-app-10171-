import { db } from '../config';

/**
 * 承認の依頼から、その依頼を出した手続きの画面へのリンクを作る（お知らせの「開く」で手続きを開くため）。
 * 手続きは依頼の ID を references やウィザードの状態に持つので、その従業員の手続きから ID を含むものを探す。見つからなければ null
 */
export async function procedureLinkForRequest(companyId: string, employeeId: string, requestId: string): Promise<{ route: string } | null> {
  // お知らせの行き先が決まらなくても、承認・差し戻しそのものは止めない
  try {
    const procs = await db.collection(`companies/${companyId}/procedures`).where('employeeId', '==', employeeId).get();
    const hit = procs.docs.find(d => d.data().deletedAt == null && JSON.stringify(d.data()).includes(requestId));
    return hit ? { route: `/procedures/${hit.id}` } : null;
  } catch {
    return null;
  }
}
