// 手続きをやめるときの決まり（だれがやめられるか・届出と承認の状態でやめられるか）
import { ProcedureDoc } from '../../types/firestore';

export interface CancelFiling {
  id: string;
  workflowStatus?: string;
  mockStatus?: string;
  submissionStatus?: string;
  cancelledAt?: unknown;
  discardedAt?: unknown;
}

/** 担当者は自分が始めた手続きだけ、管理者はだれの手続きでも（ほかの人のものは理由が要る）。null ならやめられる */
export function cancelPermissionProblem(input: { roles: string[]; uid: string; createdBy: string | undefined; creatorName: string; reason: string }): string | null {
  const own = !!input.createdBy && input.createdBy === input.uid;
  if (own) return null;
  if (!input.roles.includes('admin')) {
    return `この手続きは${input.creatorName}さんが始めたので、やめるときは${input.creatorName}さんか管理者に頼んでください`;
  }
  if (!input.reason.trim()) return 'ほかの人が始めた手続きをやめるときは、理由を入れてください';
  return null;
}

/** 手続きにつながる届出の ID。ウィザードの状態の filingId・〜FilingId・filingIds と、手続きの参照（filing）から集める */
export function procedureFilingIds(proc: Pick<ProcedureDoc, 'references'> & Record<string, unknown>): string[] {
  const ids = new Set<string>();
  for (const r of proc.references ?? []) if (r.type === 'filing' && r.documentId) ids.add(r.documentId);
  const walk = (v: unknown, depth: number) => {
    if (!v || typeof v !== 'object' || depth > 6) return;
    if (Array.isArray(v)) { v.forEach(x => walk(x, depth + 1)); return; }
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (/filingid$/i.test(k) && typeof x === 'string' && x) ids.add(x);
      else if (/filingids$/i.test(k) && Array.isArray(x)) x.forEach(y => typeof y === 'string' && y && ids.add(y));
      else walk(x, depth + 1);
    }
  };
  for (const key of ['onboarding', 'resignation', 'dependentChange', 'leaveProcedure', 'gradeRevision', 'ageEvent', 'employmentChange', 'transfer', 'gradeCorrection']) {
    walk(proc[key], 0);
  }
  return [...ids];
}

/**
 * 届出の状態でやめられるか。承認を頼んでいる最中・承認済み・提出済みの届出があればやめられない（理由を返す）。
 * 下書き・差し戻しの届出は、やめるときに一緒に取り下げる（discard に入れる）
 */
export function filingCancelPlan(filings: CancelFiling[]): { problem: string | null; discard: string[] } {
  const live = filings.filter(f => !f.cancelledAt && !f.discardedAt && f.workflowStatus !== 'cancelled');
  if (live.some(f => f.workflowStatus === 'pending')) {
    return { problem: '承認を頼んでいる届出があります。承認者に差し戻してもらってから、やめてください', discard: [] };
  }
  const done = (f: CancelFiling) => f.workflowStatus === 'approved'
    || (f.submissionStatus ?? 'notSubmitted') !== 'notSubmitted' || (f.mockStatus ?? 'notStarted') !== 'notStarted';
  if (live.some(done)) {
    return { problem: '承認済み・提出済みの届出があるため、やめられません。届出の画面から訂正届・取消届で対応してください', discard: [] };
  }
  return { problem: null, discard: live.map(f => f.id) };
}
