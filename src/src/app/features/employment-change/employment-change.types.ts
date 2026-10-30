import { Evaluation } from '../onboarding/onboarding.types';

/** サーバー（functions/src/employment-change）の戻り値に合わせた型 */

export type ChangeKey = 'entry' | 'change_approval' | 'filing' | 'approval' | 'submit' | 'confirm' | 'done';
export type ChangeEffect = 'none' | 'acquire' | 'lose';

export interface ChangeJudgement extends Evaluation {
  effect: ChangeEffect;
  effectLabel: string;
  qualificationDate: string | null;
  baseSalary: number;
  notes: string[];
  fixedWageChanged: boolean;
}

export interface ChangeView {
  procedure: {
    id: string; version: number; status: string; title: string; reason: 'change' | 'renewal';
    officeId: string; officeName: string; employeeName: string;
  };
  current: ChangeKey;
  steps: { id: string; label: string; status: string; statusDetail: string | null }[];
  employee: { id: string; employeeNumber: string; name: string; otherEmployer?: string | null };
  before: null | {
    employmentType: string; weeklyHours: number; monthlyDays: number; baseSalary: number;
    contractType: string; contractEndDate: string | null; health: boolean; pension: boolean; insuredCategory: string;
  };
  effectiveDate: string | null;
  input: Record<string, unknown> | null;
  effect: ChangeEffect;
  effectLabel: string;
  qualificationDate: string | null;
  applied: boolean;
  changeApproval: null | { status: string; comment: string | null };
  filingLabel: string;
  filing: null | { id: string; version: number; workflowStatus: string; mockStatus: string; submissionStatus: string; resultNote: string | null };
  approval: null | { status: string; comment: string | null };
}
