import type { RunCorrectionInfo, RunCorrectionRow } from '../filings/run-correction/run-correction';
import { StatusTone } from '../../shared/ui';

// functions/src/santei/santei-calc.ts・service.ts と同じ形
export type SanteiStatus = 'ok' | 'excluded' | 'pending' | 'needsAction';
export type InsuredCategory = 'general' | 'partTimer' | 'shortTime';

export interface SanteiGrade {
  healthGradeNumber: number;
  healthStandardRemuneration: number;
  pensionGradeNumber: number;
  pensionStandardRemuneration: number;
}

export interface SanteiMonth {
  yearMonth: string;
  paymentBasisDays: number | null;
  remuneration: number | null;
  cash: number | null;
  inKind: number | null;
  retroactive: number;
  used: boolean;
}

export interface SanteiApproval {
  status: 'none' | 'pending' | 'approved' | 'rejected';
  requestId: string | null;
  requestedBy: string | null;
  rejection: string | null;
}

export interface SanteiRow {
  employeeId: string;
  employeeNumber: string;
  employeeName: string;
  status: SanteiStatus;
  reason: string;
  insuredCategory: InsuredCategory;
  months: SanteiMonth[];
  basis: 'days17' | 'days15' | 'days11' | 'none' | 'previous' | null;
  average: number | null;
  current: SanteiGrade | null;
  currentEffectiveMonth: string | null;
  proposed: SanteiGrade | null;
  changed: boolean;
  decision: 'previous' | null;
  approval: SanteiApproval;
  hold: { reason: string } | null;
  filingId: string | null;
  septemberTaken: boolean;
}

export type FilingStatus = 'draft' | 'pending' | 'approved' | 'submitted' | 'cancelled';

export interface FilingSummary {
  id: string;
  number: number;
  status: FilingStatus;
  personCount: number;
  requestedBy: string | null;
  requestedAt: string | null;
  mine: boolean;
  rejection: string | null;
  submission: { method: 'mock' | 'paper'; date: string; acceptanceNumber: string | null } | null;
  /** 模擬電子申請の状態（送信中・送信エラー・返戻など） */
  mockStatus: string | null;
  /** 訂正届・取消届まわり */
  correction: RunCorrectionInfo;
  version: number;
  createdAt: string | null;
}

export interface FilingPerson {
  employeeId: string;
  被保険者整理番号: string;
  被保険者氏名: string;
  生年月日: string;
  適用年月: string;
  従前の標準報酬月額_健康保険: number | null;
  従前の標準報酬月額_厚生年金: number | null;
  従前の改定月: string | null;
  months: { 月: number; 支払基礎日数: number; 通貨: number; 現物: number; 合計: number }[];
  総計: number;
  平均額: number | null;
  修正平均額: number | null;
  決定_健康保険等級: number;
  決定_健康保険標準報酬月額: number;
  決定_厚生年金等級: number;
  決定_厚生年金標準報酬月額: number;
  備考: string;
  備考区分?: number[];
  備考その他?: string;
}

export interface FilingDetail extends FilingSummary {
  header: Record<string, string | number>;
  persons: FilingPerson[];
  /** 訂正届・取消届：元の届出の行と訂正箇所 */
  originalPersons: FilingPerson[] | null;
  corrections: RunCorrectionRow[];
}

export type SanteiAction = 'requestGradeApproval' | 'approveGrade';

export interface JobSummary {
  id: string;
  action: SanteiAction;
  label: string;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  status: 'running' | 'completed' | 'stalled';
  createdAt: string | null;
  completedAt: string | null;
}

export interface Overview {
  office: { id: string; name: string };
  year: number;
  effectiveMonth: string;
  filingPeriod: { from: string; to: string };
  gradeReview: { requestedBy: string; requestedAt: string | null; mine: boolean } | null;
  me: { uid: string; canApprove: boolean };
  rows: SanteiRow[];
  filings: FilingSummary[];
  job: JobSummary | null;
}

export type StepKey = 'target' | 'review' | 'filing' | 'submit';

export const ACTION_STEP: Record<SanteiAction, StepKey> = { requestGradeApproval: 'review', approveGrade: 'review' };

export const INSURED_CATEGORY_LABELS: Record<InsuredCategory, string> = {
  general: '一般（17日以上）',
  partTimer: 'パート（17日以上。なければ15日以上）',
  shortTime: '短時間労働者（11日以上）',
};

export const FILING_STATUS_LABELS: Record<FilingStatus, string> = {
  draft: '下書き', pending: '承認待ち', approved: '承認済み（提出前）', submitted: '提出済み', cancelled: '取り消し',
};

/**
 * 1人分のステップごとの状態。サーバーの santei/progress.ts の santeiStepState と同じ判定（変えるときは両方を直す。色は画面だけ：
 * 自分が進める＝yours、給与の未承認・決め方・差し戻し＝attention）。
 * そのステップの対象でなければ null
 */
export function stepState(step: Exclude<StepKey, 'submit'>, r: SanteiRow): { tone: StatusTone; label: string } | null {
  switch (step) {
    case 'target':
      if (r.status === 'excluded') return { tone: 'done', label: '対象外' };
      if (r.status === 'pending') return { tone: 'attention', label: r.months.some(m => m.cash === null) ? '給与 未登録' : '給与 未承認' };
      if (r.status === 'needsAction') return { tone: 'attention', label: '決め方が必要' };
      return { tone: 'done', label: '対象' };
    case 'review':
      if (r.approval.status === 'approved') return { tone: 'done', label: '承認済み' };
      if (r.approval.status === 'pending') return { tone: 'waiting', label: '承認待ち' };
      if (r.status !== 'ok') return null;
      return r.approval.status === 'rejected' ? { tone: 'attention', label: '差し戻し' } : { tone: 'yours', label: '依頼前' };
    case 'filing':
      if (r.approval.status !== 'approved') return null;
      return r.filingId ? { tone: 'done', label: '届出に記載' } : { tone: 'yours', label: '届出 未作成' };
  }
}

/** 等級の変化を短く（例：健保 22→23・厚年 19→20） */
export function gradeChangeText(r: SanteiRow): string {
  if (!r.proposed) return '';
  if (!r.current) return `健保 ${r.proposed.healthGradeNumber}・厚年 ${r.proposed.pensionGradeNumber}（今の等級なし）`;
  if (!r.changed) return `変わらない（健保 ${r.current.healthGradeNumber}・厚年 ${r.current.pensionGradeNumber}）`;
  return `健保 ${r.current.healthGradeNumber}→${r.proposed.healthGradeNumber}・厚年 ${r.current.pensionGradeNumber}→${r.proposed.pensionGradeNumber}`;
}

/** 算定の対象年：1〜3月は前年の届出を確かめることが多いため前年、それ以外は今年 */
export function defaultSanteiYear(today = new Date()): number {
  return today.getMonth() < 3 ? today.getFullYear() - 1 : today.getFullYear();
}
