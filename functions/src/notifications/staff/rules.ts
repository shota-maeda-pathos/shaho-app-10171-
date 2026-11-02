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

export interface NoticeLink { route: string; queryParams: Record<string, string> }

/**
 * お知らせを押したときに開く画面。書いたときに残した link、なければ種類と ID から決める。開く画面がなければ null。
 * 一括型の run のIDは `{事業所}_{年}`（算定）・`{事業所}_{支給月}`（賞与・毎月の処理）
 */
export function noticeLink(n: { link?: { route?: string; queryParams?: Record<string, string> } | null; targetType?: string; targetId?: string | null }): NoticeLink | null {
  if (n.link?.route) return { route: n.link.route, queryParams: n.link.queryParams ?? {} };
  const id = n.targetId ?? '';
  const run = id.match(/^(.+)_([^_]+)$/);
  switch (n.targetType) {
    case 'procedure': return id ? { route: `/procedures/${id}`, queryParams: {} } : null;
    case 'santeiRun': return run ? { route: '/santei', queryParams: { officeId: run[1], year: run[2] } } : null;
    case 'bonusRun': return run ? { route: '/bonus', queryParams: { officeId: run[1], month: run[2] } } : null;
    case 'monthlyRun': return run ? { route: '/monthly', queryParams: { officeId: run[1], payMonth: run[2] } } : null;
    case 'approvalRequest': case 'approvalBulk': case 'approvalReminder': return { route: '/approvals', queryParams: {} };
    // 承認を取り消した届出・提出の結果は届出の一覧から開く（古いお知らせは届出を特定できない）
    case 'approvalAutoCancel': case 'filing': return { route: '/filings', queryParams: {} };
    default: return null;
  }
}
