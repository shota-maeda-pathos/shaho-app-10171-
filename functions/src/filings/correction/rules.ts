import { diffSnapshots, DiffRow } from '../../approvals/index/rules';
import { stateOf } from '../submission/rules';

// 訂正届・取消届（カタログ 届出⑩）。提出済みの届出の誤りを直す・取り消すときに、元の届出から作る。
// 訂正届は元の記入内容を写して直し、元との差分を「訂正箇所」として持つ。取消届は元の内容をそのまま持つ。

export type CorrectionKind = 'correction' | 'cancellation';
export const CORRECTION_KINDS: CorrectionKind[] = ['correction', 'cancellation'];
export const isCorrectionType = (t: unknown): t is CorrectionKind => t === 'correction' || t === 'cancellation';

/** 元の届出を提出し終えているか（模擬電子申請の完了か、紙で提出・受理） */
export function isSubmittedFiling(data: Record<string, any>): boolean {
  const { mock, paper } = stateOf('employee', data);
  return mock?.status === 'completed' || paper?.status === 'submitted' || paper?.status === 'accepted';
}

/** 訂正届・取消届を作れるか。作れないときは理由 */
export function correctionBlocker(original: Record<string, any>, kind: CorrectionKind): string | null {
  if (isCorrectionType(original.filingType)) return '訂正届・取消届をさらに訂正・取消することはできません。元の届出から作り直してください';
  if (original.cancelledAt) return 'この届出は取り消し済みです';
  if (!isSubmittedFiling(original)) {
    return kind === 'correction'
      ? 'まだ提出していない届出は訂正届ではなく、承認を取り消して直します'
      : 'まだ提出していない届出は取消届ではなく、承認を取り消すか手続きを取り消します';
  }
  return null;
}

/** 書き換えてよい項目（元の届出にある、配列・オブジェクトでない項目） */
export function editableFields(originalForm: Record<string, unknown>): string[] {
  return Object.keys(originalForm).filter(k => originalForm[k] === null || typeof originalForm[k] !== 'object');
}

/**
 * 直した内容を当てはめる。元の届出にない項目や、一覧（配列）の項目は書き換えない。
 * 数値だった項目は数値に戻す（空欄は null）
 */
export function applyPatch(originalForm: Record<string, unknown>, current: Record<string, unknown>, patch: Record<string, unknown>): {
  formData: Record<string, unknown>; rejected: string[];
} {
  const allowed = new Set(editableFields(originalForm));
  const formData = { ...current };
  const rejected: string[] = [];
  for (const [key, raw] of Object.entries(patch)) {
    if (!allowed.has(key)) { rejected.push(key); continue; }
    const before = originalForm[key];
    if (typeof before === 'number') {
      const text = String(raw ?? '').replace(/[,\s円]/g, '');
      if (text === '') { formData[key] = null; continue; }
      const n = Number(text);
      if (!Number.isFinite(n)) { rejected.push(key); continue; }
      formData[key] = n;
    } else {
      formData[key] = raw === null || raw === undefined ? '' : String(raw).trim();
    }
  }
  return { formData, rejected };
}

/** 訂正箇所（元の届出の記入内容との差分） */
export function correctionsOf(originalForm: Record<string, unknown>, formData: Record<string, unknown>): DiffRow[] {
  return diffSnapshots({ formData: originalForm }, { formData });
}

/** 模擬電子申請の前に確かめること */
export function correctionErrors(data: Record<string, any>): string[] {
  const errors: string[] = [];
  if (!String(data.reason ?? '').trim()) errors.push(data.filingType === 'correction' ? '訂正の理由' : '取消の理由');
  if (data.filingType === 'correction' && !(data.corrections ?? []).length) errors.push('訂正箇所（元の届出から直した項目がありません）');
  if (!data.formData?.['被保険者氏名']) errors.push('被保険者氏名');
  return errors;
}
