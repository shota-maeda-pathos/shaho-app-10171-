/** サーバー（functions/src/grade-revision）の戻り値に合わせた型 */

export type RevisionKey = 'change' | 'judge' | 'filing' | 'approval' | 'submit' | 'confirm' | 'done';
export type RevisionKind = 'occasional' | 'maternityEnd' | 'childcareEnd';
export type Direction = 'up' | 'down';

export interface LeaveFacts {
  procedureId: string | null;
  endDate: string | null;
  childName: string;
  childBirthDate: string | null;
  nextLeaveFromNextDay: boolean;
  applied: boolean;
  appliedDate: string | null;
}

export interface MonthRow {
  yearMonth: string;
  status: 'ok' | 'missing' | 'unconfirmed';
  totalSalary: number | null;
  inKind: number | null;
  retroactive: number | null;
  remuneration: number | null;
  paymentBasisDays: number | null;
  used: boolean;
  short: boolean;
}

export interface InsuranceResult {
  enrolled: boolean;
  eligible: boolean;
  currentGrade: number | null;
  currentStandard: number | null;
  newGrade: number | null;
  newStandard: number | null;
  diff: number | null;
  reason: string;
}

export interface Judgement {
  status: 'waiting' | 'eligible' | 'ineligible' | 'review';
  kind: RevisionKind;
  startMonth: string;
  effectiveMonth: string;
  months: MonthRow[];
  minDays: number;
  total: number | null;
  average: number | null;
  averageWithRetro: number | null;
  health: InsuranceResult;
  pension: InsuranceResult;
  messages: string[];
}

export interface Evaluation {
  startMonth: string | null;
  effectiveMonth: string | null;
  fixedWage: null | {
    changed: boolean | null; direction: Direction | null; needsInput: boolean; message: string;
    before: number | null; after: number | null; beforeMonth: string | null;
  };
  leaveCheck: { missing: string[]; blocking: string[] } | null;
  judgement: Judgement | null;
  conflict: string | null;
}

export interface Decision {
  startMonth: string;
  effectiveMonth: string;
  months: { yearMonth: string; totalSalary: number; inKind: number; retroactive: number; remuneration: number; paymentBasisDays: number; used: boolean }[];
  total: number;
  average: number;
  averageWithRetro: number;
  direction: Direction | null;
  health: Omit<InsuranceResult, 'enrolled' | 'diff' | 'reason'>;
  pension: Omit<InsuranceResult, 'enrolled' | 'diff' | 'reason'>;
  decidedAt: string;
}

export interface RevisionView {
  procedure: {
    id: string; version: number; status: string; title: string; kind: RevisionKind; kindLabel: string;
    officeId: string; officeName: string; employeeName: string;
  };
  current: RevisionKey;
  steps: { id: string; label: string; status: string; statusDetail: string | null }[];
  employee: { id: string; employeeNumber: string; name: string; otherEmployer?: string | null };
  form: {
    startMonth: string | null; manualDirection: Direction | null; previousRemuneration: number | null; note: string; leave: LeaveFacts | null;
  };
  evaluation: Evaluation | null;
  decision: Decision | null;
  closedReason: string | null;
  filingLabel: string;
  filing: null | { id: string; version: number; workflowStatus: string; mockStatus: string; submissionStatus: string; resultNote: string | null };
  approval: null | { status: string; comment: string | null };
  locked: boolean;
  recalcMonths: string[];
}

export interface ChangeForm {
  startMonth: string;
  manualDirection: Direction | null;
  previousRemuneration: number | null;
  note: string;
  endDate: string;
  childName: string;
  childBirthDate: string;
  nextLeaveFromNextDay: boolean;
  applied: boolean;
  appliedDate: string;
}

export function monthLabel(ym: string | null | undefined) {
  if (!ym) return '';
  return `${Number(ym.slice(0, 4))}年${Number(ym.slice(5, 7))}月`;
}

export function addMonth(ym: string, n: number) {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}
