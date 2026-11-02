import type { SanteiFilingSummary, SanteiOverviewRow } from './service';

export type SanteiStepKey = 'target' | 'review' | 'filing' | 'submit';
export type SanteiTone = 'action' | 'yours' | 'waiting' | 'done';

/**
 * 1人分のステップごとの状態。画面の santei.types.ts の stepState と同じ判定（変えるときは両方を直す）。
 * そのステップの対象でなければ null
 */
export function santeiStepState(step: Exclude<SanteiStepKey, 'submit'>, r: Pick<SanteiOverviewRow, 'status' | 'approval' | 'filingId' | 'months'>): { tone: SanteiTone; label: string } | null {
  switch (step) {
    case 'target':
      if (r.status === 'excluded') return { tone: 'done', label: '対象外' };
      if (r.status === 'pending') return { tone: 'action', label: r.months.some(m => m.cash === null) ? '給与 未登録' : '給与 未承認' };
      if (r.status === 'needsAction') return { tone: 'action', label: '決め方が必要' };
      return { tone: 'done', label: '対象' };
    case 'review':
      if (r.approval.status === 'approved') return { tone: 'done', label: '承認済み' };
      if (r.approval.status === 'pending') return { tone: 'waiting', label: '承認待ち' };
      if (r.status !== 'ok') return null;
      return { tone: 'action', label: r.approval.status === 'rejected' ? '差し戻し' : '依頼前' };
    case 'filing':
      if (r.approval.status !== 'approved') return null;
      return r.filingId ? { tone: 'done', label: '届出に記載' } : { tone: 'action', label: '届出 未作成' };
  }
}

/**
 * ホームに出す「次にやること」。自分がやることのある最初のステップ、なければ待ちの内容。すべて終わっていれば null。
 * 承認者には、自分が依頼していない承認待ちを「あなたの番」にする
 */
export function santeiProgress(input: {
  rows: SanteiOverviewRow[]; filings: SanteiFilingSummary[]; canApprove: boolean; uid: string;
}): { next: string; tone: 'action' | 'yours' | 'waiting'; approve?: boolean; detail: string | null } | null {
  const rows = input.rows.filter(r => !r.hold);
  const count = (step: Exclude<SanteiStepKey, 'submit'>, tone: SanteiTone) => rows.filter(r => santeiStepState(step, r)?.tone === tone).length;
  const target = count('target', 'action');
  if (target) return { next: '対象者を確かめる', tone: 'action', detail: `${target}名が要対応（給与の未承認・支払基礎日数の不足など）` };
  const toRequest = count('review', 'action');
  if (toRequest) return { next: '等級の承認を依頼する', tone: 'action', detail: `${toRequest}名が依頼前・差し戻し` };
  const waitingGrades = rows.filter(r => r.approval.status === 'pending');
  const forMe = waitingGrades.filter(r => r.approval.requestedBy !== input.uid);
  if (input.canApprove && forMe.length) return { next: '等級を承認する', tone: 'yours', approve: true, detail: `${forMe.length}名の承認を頼まれています` };
  const toFile = count('filing', 'action');
  if (toFile) return { next: '算定基礎届を作る', tone: 'action', detail: `${toFile}名がまだ届出に載っていません` };
  const active = input.filings.filter(f => f.status !== 'cancelled');
  const draft = active.find(f => f.status === 'draft');
  if (draft) return { next: draft.rejection ? '差し戻された届出を直す' : '届出の承認を依頼する', tone: 'action', detail: draft.rejection ? `差し戻しの理由：${draft.rejection}` : null };
  const sending = active.find(f => f.status === 'approved' && ['sent', 'received', 'processing'].includes(f.mockStatus ?? ''));
  const approved = active.find(f => f.status === 'approved' && f !== sending);
  if (approved) return { next: approved.mockStatus === 'returned' ? '返戻された算定基礎届を直す' : approved.mockStatus === 'failed' ? '算定基礎届を送り直す' : '算定基礎届を提出する', tone: 'action', detail: `${approved.personCount}名` };
  if (sending) return { next: '模擬電子申請の処理を待っています', tone: 'waiting', detail: `${sending.personCount}名の算定基礎届` };
  const pending = active.find(f => f.status === 'pending');
  if (pending && input.canApprove && !pending.mine) return { next: '届出を承認する', tone: 'yours', approve: true, detail: `${pending.personCount}名の算定基礎届` };
  if (pending) return { next: '届出の承認を待っています', tone: 'waiting', detail: null };
  if (waitingGrades.length) return { next: '等級の承認を待っています', tone: 'waiting', detail: `${waitingGrades.length}名` };
  return null;
}
