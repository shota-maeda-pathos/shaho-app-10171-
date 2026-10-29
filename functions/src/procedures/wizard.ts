import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { ProcedureDoc, ProcedureStep } from '../types/firestore';
import { invalidArg } from '../utils/errors';

// 個人型の手続き（ウィザード）で共通に使う小さな処理

export function setStep(steps: ProcedureStep[], id: string, patch: Partial<ProcedureStep>) {
  return steps.map(s => s.id === id ? { ...s, ...patch } : s);
}

export function completed(by: string): Partial<ProcedureStep> {
  return { status: 'completed', completedAt: Timestamp.now(), completedBy: by, statusDetail: null, actionLabel: null, actionRoute: null };
}

export function statusReasonOf(steps: ProcedureStep[]) {
  const next = steps.find(s => s.status === 'available' || s.status === 'in_progress' || s.status === 'returned');
  return next ? next.label : '全ステップ完了';
}

export function requireVersion(proc: ProcedureDoc, expected: number) {
  if (proc.version !== expected) throw new HttpsError('aborted', '手続きが更新されています。画面を読み込み直してください');
  if (proc.status === 'completed' || proc.status === 'cancelled') throw invalidArg('この手続きは終了しています');
}

export const stepOf = (proc: ProcedureDoc, id: string) => proc.steps.find(s => s.id === id)!;
export const isDone = (s: ProcedureStep) => s.status === 'completed' || s.status === 'skipped';

/** 届出の承認申請のID。共通の更新処理が承認ステップの参照を届出に書き換えるため、参照の一覧から引く */
export function latestApprovalId(proc: ProcedureDoc): string | null {
  const refs = proc.references.filter(r => r.type === 'approval' && r.stepId === 'approval');
  return refs.length ? refs[refs.length - 1].documentId : null;
}

/** 東京の今日 YYYY-MM-DD */
export const todayJst = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
