import { StatusTone } from '../../shared/ui';

export type MonthlyAction = 'requestSalaryApproval' | 'approveSalary' | 'calculate' | 'requestPremiumApproval' | 'approvePremium' | 'publish' | 'recordPayroll';
export type StepKey = 'salary' | 'salaryReview' | 'calculate' | 'premiumReview' | 'publish' | 'collection';

export interface MonthlyRow {
  employeeId: string;
  employeeNumber: string;
  name: string;
  salaryRequired: boolean;
  premiumDue: boolean;
  premiumNote: string;
  salary: null | { total: number; inKind: number; basisDays: number; noPay: boolean; noPayReason: string; confirmed: boolean; pending: boolean; published: boolean; version: number };
  premium: null | { employee: number; employer: number; healthGrade: number; pensionGrade: number; exempted: boolean; confirmed: boolean; pending: boolean; version: number };
  previous: null | { employee: number; employer: number };
  diff: number | null;
  diffReasons: string[];
  issues: string[];
  warnings: string[];
  collection: {
    plan: 'payroll' | 'transfer' | 'none'; due: number; collected: number | null; status: 'none' | 'unpaid' | 'partial' | 'done' | 'over'; version: number;
    entries: { method: string; amount: number; date: string; note: string }[];
  };
  hold: null | { reason: string };
}

export interface JobSummary {
  id: string;
  action: MonthlyAction;
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
  office: { id: string; name: string };
  payMonth: string;
  premiumMonth: string;
  deductionMethod: 'current' | 'previous';
  totals: { employee: number; employer: number; previousEmployee: number; previousEmployer: number; salary: number; collected: number; due: number };
  reviews: { salary: Review | null; premium: Review | null };
  me: { uid: string; canApprove: boolean };
  rows: MonthlyRow[];
  job: JobSummary | null;
}

export interface ImportResult {
  dryRun: boolean;
  rows: { line: number; employeeNumber: string; name: string; total: number; inKind: number; noPay: boolean; overwrite: boolean }[];
  errors: { line: number; employeeNumber: string; message: string }[];
  imported: number;
}

/** 一覧の1行の状態（ステップごと）。null はそのステップの対象外 */
export interface StepState { tone: StatusTone; label: string; reason?: string }

export const ACTION_STEP: Record<MonthlyAction, StepKey> = {
  requestSalaryApproval: 'salaryReview', approveSalary: 'salaryReview', calculate: 'calculate',
  requestPremiumApproval: 'premiumReview', approvePremium: 'premiumReview', publish: 'publish', recordPayroll: 'collection',
};

const yen = (n: number) => `${n.toLocaleString('ja-JP')}円`;

/** 各ステップでの1人分の状態。要対応（action）の人が残っているステップは未完了 */
export function stepState(step: StepKey, r: MonthlyRow): StepState | null {
  const s = r.salary;
  const p = r.premium;
  switch (step) {
    case 'salary':
      if (!r.salaryRequired) return null;
      if (!s) return { tone: 'action', label: '給与 未登録', reason: '取り込むか、給与がない月なら「無給として記録」してください' };
      return { tone: 'done', label: s.noPay ? '無給' : `給与 ${yen(s.total)}`, reason: s.noPay ? s.noPayReason : undefined };
    case 'salaryReview':
      if (!s) return null;
      if (s.confirmed) return { tone: 'done', label: '承認済み' };
      if (s.pending) return { tone: 'waiting', label: '承認待ち' };
      return { tone: 'yours', label: '確認の依頼前' };
    case 'calculate':
      if (r.issues.length) return { tone: 'action', label: '計算できません', reason: r.issues.join('／') };
      if (!r.premiumDue) return null;
      if (!p) return { tone: 'yours', label: '未計算' };
      return { tone: 'done', label: `本人 ${yen(p.employee)}` };
    case 'premiumReview':
      if (!p) return null;
      if (p.confirmed) return { tone: 'done', label: '承認済み' };
      if (p.pending) return { tone: 'waiting', label: '承認待ち' };
      if (r.warnings.length) return { tone: 'action', label: '確認が必要', reason: r.warnings.join('／') };
      return { tone: 'yours', label: '確認の依頼前', reason: r.diffReasons.join('／') || undefined };
    case 'publish':
      if (!s) return null;
      if (s.published) return { tone: 'done', label: '公開済み' };
      if (!s.confirmed) return { tone: 'waiting', label: '給与の承認待ち' };
      if (p && !p.confirmed) return { tone: 'waiting', label: '保険料の承認待ち' };
      return { tone: 'yours', label: '公開前' };
    case 'collection': {
      const c = r.collection;
      if (!p || c.plan === 'none') return null;
      if (!p.confirmed) return { tone: 'waiting', label: '保険料の承認待ち' };
      const method = c.plan === 'payroll' ? '給与から控除' : '別途入金';
      switch (c.status) {
        case 'done': return { tone: 'done', label: `徴収済み（${method}）` };
        case 'over': return { tone: 'action', label: '過徴収', reason: `${yen((c.collected ?? 0) - c.due)}を返金してください` };
        case 'partial': return { tone: 'action', label: '一部未徴収', reason: `残り ${yen(c.due - (c.collected ?? 0))}` };
        default: return c.plan === 'payroll'
          ? { tone: 'yours', label: '控除の記録前', reason: `${yen(c.due)}を給与から控除` }
          : { tone: 'action', label: '別途入金 未入金', reason: `${yen(c.due)}を本人から集めてください` };
      }
    }
  }
}
