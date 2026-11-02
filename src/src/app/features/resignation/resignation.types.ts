/** サーバー（functions/src/resignation）の戻り値に合わせた型 */

export type ResignationKey = 'entry' | 'settlement' | 'account' | 'filing' | 'approval' | 'submit' | 'confirm' | 'done';
export type LossReason = 'resignation' | 'death';

export interface ResignationFacts {
  lossDate: string;
  lossCause: string;
  lost: { health: boolean; pension: boolean };
  over70Worker: boolean;
  needsFiling: boolean;
  insured: boolean;
  sameMonth: boolean;
  lastChargedMonth: string | null;
  filingDeadline: string | null;
  account: { viewOnlyFrom: string; accessUntil: string; loginStopsFrom: string };
  foreignNotice: string | null;
  notes: string[];
}

export type SettlementPlanKind = 'unknown' | 'none' | 'collected' | 'over' | 'payroll' | 'final' | 'transfer';

export interface Settlement {
  rows: {
    month: string; due: number; dueSource: 'confirmed' | 'calculated' | 'estimate' | 'noGrade'; collected: number;
    remaining: number; normalPayMonth: string; plan: SettlementPlanKind; payMonth: string | null;
  }[];
  totals: { due: number; collected: number; payroll: number; final: number; transfer: number; over: number };
  hasEstimate: boolean;
  unknownMonths: string[];
}

export interface ResignationView {
  procedure: { id: string; version: number; status: string; title: string; officeId: string; officeName: string; employeeName: string };
  current: ResignationKey;
  steps: { id: string; label: string; status: string; statusDetail: string | null }[];
  employee: {
    id: string; employeeNumber: string; name: string; birthDate: string | null; hireDate: string | null;
    acquisitionDate: string | null; isForeign: boolean; enrolled: { health: boolean; pension: boolean };
    /** 二以上事業所勤務のほかの勤め先（古いサーバーは返さない） */
    otherEmployer?: string | null;
  };
  office: { deductionMethod: 'previous' | 'current'; paymentDay: number | null };
  entry: { resignationDate: string; reason: LossReason; note: string } | null;
  facts: ResignationFacts | null;
  settlement: (Settlement & { lastPayMonth: string | null; decided: boolean }) | null;
  account: { hasUser: boolean; email: string | null; accessUntil: string | null; viewOnlyFrom: string | null };
  cards: { returned: number; unreturnable: number } | null;
  /** 同月得喪の厚生年金保険料の還付（通知が届いたら記録する） */
  pensionRefund: { month: string; employeeAmount: number; employerAmount: number; noticeDate: string } | null;
  filing: { id: string; version: number; workflowStatus: string; mockStatus: string; submissionStatus: string; resultNote: string | null } | null;
  approval: { status: string; comment: string | null } | null;
  locked: boolean;
}

export const DUE_SOURCE_LABEL: Record<Settlement['rows'][number]['dueSource'], string> = {
  confirmed: '承認済み', calculated: '計算済み（未承認）', estimate: '見込み（未計算）', noGrade: '等級なし',
};

export function monthLabel(ym: string | null) {
  if (!ym) return '—';
  const [y, m] = ym.split('-');
  return `${y}年${Number(m)}月`;
}
