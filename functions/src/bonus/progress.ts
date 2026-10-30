import type { BonusFilingSummary, BonusRow } from './service';

export type BonusStepKey = 'entry' | 'review' | 'premium' | 'filing';
export type BonusTone = 'action' | 'yours' | 'waiting' | 'done';

type StepRow = Pick<BonusRow, 'bonus' | 'target' | 'premium' | 'stale' | 'issues' | 'rejected' | 'filingId'>;

/**
 * 1人分のステップごとの状態。画面の bonus.types.ts の stepState と同じ判定（変えるときは両方を直す）。
 * そのステップの対象でなければ null
 */
export function bonusStepState(step: BonusStepKey, r: StepRow): { tone: BonusTone; label: string } | null {
  if (!r.bonus) return null;
  const premiumTarget = r.bonus.confirmed && r.target !== 'excluded';
  switch (step) {
    case 'entry':
      if (r.rejected.bonus && !r.bonus.pending && !r.bonus.confirmed) return { tone: 'action', label: '差し戻し' };
      if (r.issues.length && !r.bonus.confirmed) return { tone: 'action', label: '要確認' };
      return { tone: 'done', label: r.target === 'excluded' ? '登録済み（届出不要）' : '登録済み' };
    case 'review':
      if (r.bonus.confirmed) return { tone: 'done', label: '承認済み' };
      if (r.bonus.pending) return { tone: 'waiting', label: '承認待ち' };
      return { tone: 'action', label: r.rejected.bonus ? '差し戻し' : '依頼前' };
    case 'premium':
      if (!premiumTarget) return null;
      if (r.premium?.confirmed) return { tone: 'done', label: r.premium.exempted ? '承認済み（免除）' : '承認済み' };
      if (r.premium?.pending) return { tone: 'waiting', label: '承認待ち' };
      if (!r.premium) return { tone: 'action', label: '未計算' };
      if (r.stale) return { tone: 'action', label: '計算し直し' };
      return { tone: 'action', label: r.rejected.premium ? '差し戻し' : '依頼前' };
    case 'filing':
      if (!premiumTarget || !r.premium?.confirmed) return null;
      return r.filingId ? { tone: 'done', label: '届出に記載' } : { tone: 'action', label: '届出 未作成' };
  }
}

/**
 * ホームに出す「次にやること」。自分がやることのある最初のステップ、なければ待ちの内容。すべて終わっていれば null。
 * 承認者には、自分が依頼していない承認待ちを「あなたの番」にする。
 * 支給予定月が終わったのに賞与が1件もなく、不支給報告書の記録もなければ、それを知らせる
 */
export function bonusProgress(input: {
  rows: BonusRow[]; filings: BonusFilingSummary[]; canApprove: boolean; uid: string;
  reviews: { bonus: { mine: boolean } | null; premium: { mine: boolean } | null };
  scheduled: boolean; monthEnded: boolean; nonPayment: unknown;
}): { next: string; tone: 'action' | 'yours' | 'waiting'; detail: string | null } | null {
  const paid = input.rows.filter(r => r.bonus);
  if (!paid.length) {
    const report = input.filings.find(f => f.filingType === 'bonusNonPayment' && f.status !== 'cancelled');
    if (report) return reportProgress(report, input.canApprove);
    if (input.scheduled && input.monthEnded && !input.nonPayment) {
      return { next: '賞与不支給報告書の提出が必要です', tone: 'action', detail: '支給予定月に賞与が登録されていません。支給した場合は賞与を登録し、支給しなかった場合は報告書を作ります' };
    }
    return null;
  }
  const rows = paid.filter(r => !r.hold);
  const count = (step: BonusStepKey, tone: BonusTone) => rows.filter(r => bonusStepState(step, r)?.tone === tone).length;
  const entry = count('entry', 'action');
  if (entry) return { next: '賞与を確かめる', tone: 'action', detail: `${entry}名が要対応（差し戻し・未承認の前の月など）` };
  const toRequest = count('review', 'action');
  if (toRequest) return { next: '賞与額の承認を依頼する', tone: 'action', detail: `${toRequest}名が依頼前・差し戻し` };
  const bonusWaiting = count('review', 'waiting');
  if (bonusWaiting && input.canApprove && !input.reviews.bonus?.mine) return { next: '賞与額を承認する', tone: 'yours', detail: `${bonusWaiting}名の承認を頼まれています` };
  const premium = count('premium', 'action');
  if (premium) return { next: '保険料を計算して承認を依頼する', tone: 'action', detail: `${premium}名が未計算・依頼前` };
  const premiumWaiting = count('premium', 'waiting');
  if (premiumWaiting && input.canApprove && !input.reviews.premium?.mine) return { next: '保険料を承認する', tone: 'yours', detail: `${premiumWaiting}名の承認を頼まれています` };
  const toFile = count('filing', 'action');
  if (toFile) return { next: '賞与支払届を作る', tone: 'action', detail: `${toFile}名がまだ届出に載っていません` };
  const active = input.filings.filter(f => f.status !== 'cancelled' && (f.filingType ?? 'bonusPayment') === 'bonusPayment');
  const draft = active.find(f => f.status === 'draft');
  if (draft) return { next: draft.rejection ? '差し戻された届出を直す' : '届出の承認を依頼する', tone: 'action', detail: draft.rejection ? `差し戻しの理由：${draft.rejection}` : null };
  const sending = active.find(f => f.status === 'approved' && ['sent', 'received', 'processing'].includes(f.mockStatus ?? ''));
  const approved = active.find(f => f.status === 'approved' && f !== sending);
  if (approved) return { next: approved.mockStatus === 'returned' ? '返戻された賞与支払届を直す' : approved.mockStatus === 'failed' ? '賞与支払届を送り直す' : '賞与支払届を提出する', tone: 'action', detail: `${approved.personCount}名` };
  if (sending) return { next: '模擬電子申請の処理を待っています', tone: 'waiting', detail: `${sending.personCount}名の賞与支払届` };
  const pending = active.find(f => f.status === 'pending');
  if (pending && input.canApprove && !pending.mine) return { next: '届出を承認する', tone: 'yours', detail: `${pending.personCount}名の賞与支払届` };
  if (pending) return { next: '届出の承認を待っています', tone: 'waiting', detail: null };
  if (bonusWaiting) return { next: '賞与額の承認を待っています', tone: 'waiting', detail: `${bonusWaiting}名` };
  if (premiumWaiting) return { next: '保険料の承認を待っています', tone: 'waiting', detail: `${premiumWaiting}名` };
  return null;
}

/** 賞与不支給報告書の次にやること。提出し終えていれば null */
function reportProgress(f: BonusFilingSummary, canApprove: boolean): { next: string; tone: 'action' | 'yours' | 'waiting'; detail: string | null } | null {
  if (f.status === 'submitted') return null;
  if (f.status === 'draft') return { next: f.rejection ? '差し戻された賞与不支給報告書を直す' : '賞与不支給報告書の承認を依頼する', tone: 'action', detail: f.rejection ? `差し戻しの理由：${f.rejection}` : null };
  if (f.status === 'pending') return canApprove && !f.mine
    ? { next: '賞与不支給報告書を承認する', tone: 'yours', detail: null }
    : { next: '賞与不支給報告書の承認を待っています', tone: 'waiting', detail: null };
  if (['sent', 'received', 'processing'].includes(f.mockStatus ?? '')) return { next: '模擬電子申請の処理を待っています', tone: 'waiting', detail: '賞与不支給報告書' };
  return { next: '賞与不支給報告書を提出する', tone: 'action', detail: null };
}
