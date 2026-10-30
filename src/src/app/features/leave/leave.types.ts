/** サーバー（functions/src/leave-procedure）の戻り値に合わせた型 */

export type LeaveKey = 'plan' | 'filing' | 'approval' | 'submit' | 'during' | 'confirm' | 'done';
export type LeaveKind = 'maternity' | 'childcare';
export type LeaveEventType = 'birth' | 'extend' | 'end';
export type FilingKind = 'start' | 'change' | 'extend' | 'end';

export interface LeavePeriod {
  startDate: string;
  plannedEnd: string;
  actualBirthDate: string | null;
  actualEndDate: string | null;
}

export interface PlanResult {
  start: string;
  end: string;
  legalStart: string | null;
  stage: string | null;
  errors: string[];
  notes: string[];
  deadline: string | null;
  exemptMonths: string[];
  bonusExempt: boolean;
  shortLeave: boolean;
  limits?: { label: string; until: string }[];
}

export interface EventResult {
  start: string;
  end: string;
  actualBirthDate: string | null;
  filing: FilingKind | null;
  ended: boolean;
  errors: string[];
  notes: string[];
  exemptMonths: string[];
  bonusExempt: boolean;
}

export interface LeaveView {
  procedure: {
    id: string; version: number; status: string; title: string; kind: LeaveKind; kindLabel: string;
    officeId: string; officeName: string; employeeName: string; fromMaternity: boolean;
  };
  current: LeaveKey;
  steps: { id: string; label: string; status: string; statusDetail: string | null }[];
  employee: { id: string; employeeNumber: string; name: string; gender: string };
  expectedBirthDate: string | null;
  multiple: boolean;
  child: { lastName: string; firstName: string; birthDate: string; bornByEmployee: boolean } | null;
  period: LeavePeriod | null;
  plan: PlanResult | null;
  exemptMonths: string[];
  bonusExempt: boolean;
  filingKind: FilingKind;
  filingLabel: string;
  pending: { type: LeaveEventType; date: string } | null;
  history: { kind: FilingKind; filingId: string; label: string; eventDate: string | null }[];
  filing: { id: string; version: number; workflowStatus: string; mockStatus: string; submissionStatus: string; resultNote: string | null } | null;
  approval: { status: string; comment: string | null } | null;
  locked: boolean;
  exemption: { status: string; approvedAt: string | null } | null;
  recalcMonths: string[];
  deadline: string | null;
  returnMonth: string | null;
}

/** 期間の入力（画面）。空の日付は未入力 */
export interface PlanForm {
  expectedBirthDate: string;
  actualBirthDate: string;
  multiple: boolean;
  childLastName: string;
  childFirstName: string;
  childBirthDate: string;
  bornByEmployee: boolean;
  startDate: string;
  endDate: string;
}

export const EVENT_LABEL: Record<LeaveEventType, string> = { birth: '出産した', extend: '育休を延長する', end: '休業を終えて復帰した' };

/** 'YYYY-MM' を「2027年3月」に */
export function monthLabel(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  return `${y}年${m}月`;
}

/** 免除の月の並びを「2027年1月〜4月」のように短くする（続いている月をまとめる） */
export function monthsText(months: string[]) {
  if (!months.length) return 'なし';
  const first = months[0];
  const last = months[months.length - 1];
  if (months.length === 1) return monthLabel(first);
  return `${monthLabel(first)}〜${first.slice(0, 4) === last.slice(0, 4) ? `${Number(last.slice(5))}月` : monthLabel(last)}（${months.length}か月）`;
}
