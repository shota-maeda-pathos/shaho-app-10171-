/** サーバー（functions/src/age-event）の戻り値に合わせた型 */

export type AgeKey = 'check' | 'filing' | 'approval' | 'submit' | 'confirm' | 'done';
export type AgeKind = 'pension70' | 'health75';

export interface Pension70Result {
  equivalentGrade: number | null;
  equivalentStandard: number | null;
  filingRequired: boolean | null;
  message: string;
}

export interface AgeView {
  procedure: {
    id: string; version: number; status: string; title: string; kind: AgeKind; kindLabel: string;
    officeId: string; officeName: string; employeeName: string;
  };
  current: AgeKey;
  steps: { id: string; label: string; status: string; statusDetail: string | null }[];
  employee: { id: string; employeeNumber: string; name: string; birthDate: string; otherEmployer?: string | null };
  facts: { reachDate: string; lossDate: string; effect: string; lastChargedMonth: string; deadline: string };
  state: {
    remuneration: number | null; inKind: number; filingRequired: boolean | null;
    equivalentGrade: number | null; equivalentStandard: number | null;
    cardsReturned: number; cardsUnreturnable: number;
  };
  grade: null | { effectiveMonth: string; healthGrade: number; healthStandard: number; pensionGrade: number; pensionStandard: number };
  estimate: number | null;
  latestSalaryMonth: string | null;
  dependents: string[];
  filingLabel: string;
  filing: null | { id: string; version: number; workflowStatus: string; mockStatus: string; submissionStatus: string; resultNote: string | null };
  approval: null | { status: string; comment: string | null };
  locked: boolean;
}

export function monthLabel(ym: string | null | undefined) {
  if (!ym) return '';
  return `${Number(ym.slice(0, 4))}年${Number(ym.slice(5, 7))}月`;
}
