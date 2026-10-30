import { StatusTone } from '../../shared/ui';

// functions/src/bonus/bonus-calc.ts・service.ts と同じ形
export interface BonusPayment { date: string; cash: number; inKind: number }
export type BonusTarget = 'charged' | 'lossMonth' | 'excluded';

export interface BonusCaps {
  priorHealthCumulative: number;
  healthCumulative: number;
  healthCapped: number;
  pensionCapped: number;
  healthOverCap: boolean;
  pensionOverCap: boolean;
  nearHealthCap: boolean;
}

export interface BonusRow {
  employeeId: string;
  employeeNumber: string;
  name: string;
  inPeriod: boolean;
  bonus: null | {
    payments: BonusPayment[]; cash: number; inKind: number; total: number; standard: number; firstPaymentDate: string | null; combined: boolean;
    confirmed: boolean; pending: boolean; version: number;
  };
  target: BonusTarget | null;
  targetReason: string;
  caps: BonusCaps | null;
  premium: null | {
    employee: number; employer: number; healthCapped: number; pensionCapped: number; exempted: boolean;
    confirmed: boolean; pending: boolean; version: number;
  };
  stale: boolean;
  age70: boolean;
  issues: string[];
  warnings: string[];
  hold: { reason: string } | null;
  rejected: { bonus: string | null; premium: string | null };
  filingId: string | null;
}

export type FilingStatus = 'draft' | 'pending' | 'approved' | 'submitted' | 'cancelled';

export interface FilingSummary {
  id: string;
  number: number;
  status: FilingStatus;
  personCount: number;
  deadline: string | null;
  requestedBy: string | null;
  requestedAt: string | null;
  mine: boolean;
  rejection: string | null;
  submission: { method: 'mock' | 'paper'; date: string; acceptanceNumber: string | null } | null;
  version: number;
  createdAt: string | null;
}

export interface FilingPerson {
  employeeId: string;
  被保険者整理番号: string;
  被保険者氏名: string;
  生年月日: string;
  賞与支払年月日: string;
  賞与額_通貨: number;
  賞与額_現物: number;
  賞与額_合計: number;
  標準賞与額: number;
  備考区分: number[];
  初回支払日: number | null;
}

export interface FilingDetail extends FilingSummary {
  header: Record<string, string | number>;
  persons: FilingPerson[];
}

export type BonusAction = 'requestBonusApproval' | 'approveBonus' | 'calculate' | 'requestPremiumApproval' | 'approvePremium';

export interface JobSummary {
  id: string;
  action: BonusAction;
  label: string;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  status: 'running' | 'completed' | 'stalled';
  createdAt: string | null;
  completedAt: string | null;
}

export interface Review { requestedBy: string; requestedAt: string | null; mine: boolean }

export interface Overview {
  office: { id: string; name: string; bonusMonths: number[] };
  payMonth: string;
  scheduled: boolean;
  monthEnded: boolean;
  nonPayment: { reportedOn: string; by: string } | null;
  deadline: string | null;
  totals: { paidCount: number; total: number; standard: number; employee: number; employer: number };
  reviews: { bonus: Review | null; premium: Review | null };
  me: { uid: string; canApprove: boolean };
  rows: BonusRow[];
  filings: FilingSummary[];
  job: JobSummary | null;
}

export interface ImportResult {
  dryRun: boolean;
  rows: { line: number; employeeNumber: string; name: string; payments: number; total: number; standard: number; overwrite: boolean; warnings: string[] }[];
  errors: { line: number; employeeNumber: string; message: string }[];
  imported: number;
}

export type StepKey = 'entry' | 'review' | 'premium' | 'filing';

export const ACTION_STEP: Record<BonusAction, StepKey> = {
  requestBonusApproval: 'review', approveBonus: 'review', calculate: 'premium', requestPremiumApproval: 'premium', approvePremium: 'premium',
};

export const FILING_STATUS_LABELS: Record<FilingStatus, string> = {
  draft: '下書き', pending: '承認待ち', approved: '承認済み（提出前）', submitted: '提出済み', cancelled: '取り消し',
};

/**
 * 1人分のステップごとの状態。サーバーの bonus/progress.ts の bonusStepState と同じ判定（変えるときは両方を直す）。
 * そのステップの対象でなければ null。届出のステップ（filing）は、届出の作成と承認・提出を1つにまとめている
 */
export function stepState(step: StepKey, r: BonusRow): { tone: StatusTone; label: string } | null {
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

export function monthLabel(ym: string) {
  const [y, m] = ym.split('-');
  return `${y}年${Number(m)}月`;
}

/** 円の表示（万円単位の概数ではなく、そのままの額） */
export const yen = (n: number) => `${n.toLocaleString('ja-JP')}円`;
