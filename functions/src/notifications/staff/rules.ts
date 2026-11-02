// スタッフ向けのお知らせ（承認の依頼・承認・差戻し・模擬電子申請の結果・承認の自動取消・一括処理の完了など）。
// notify() で書かれたもののうち、本人ポータル・全員あて（targetType が all／office／employee）でないもの。

/** 本人・全員あての種類（ポータルとお知らせ管理で出す）。それ以外がスタッフ向け */
const BROADCAST = new Set(['all', 'office', 'employee']);

/** お知らせの事業所。書くときに残した officeId、古いものは一括型の run のID（`{事業所}_{年・月}`）から */
export function noticeOfficeId(n: { officeId?: string | null; targetType?: string; targetId?: string | null }): string | null {
  if (n.officeId) return n.officeId;
  if (n.targetId && ['santeiRun', 'bonusRun', 'monthlyRun'].includes(n.targetType ?? '')) return n.targetId.replace(/_[^_]+$/, '');
  return null;
}

/** この人に見せるか。管理者はすべて、担当者・承認者は担当事業所のものだけ（事業所の分からない古いものは管理者だけ） */
export function staffCanSee(n: { officeId?: string | null; targetType?: string; targetId?: string | null }, auth: { roles: string[]; officeIds: string[] }): boolean {
  if (BROADCAST.has(n.targetType ?? '')) return false;
  if (auth.roles.includes('admin')) return true;
  if (!auth.roles.some(r => r === 'operator' || r === 'approver')) return false;
  const office = noticeOfficeId(n);
  return !!office && auth.officeIds.includes(office);
}
