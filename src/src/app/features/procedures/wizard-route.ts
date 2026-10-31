/**
 * 手続きを開く画面。ウィザード方式の手続きはそれぞれの画面、旧方式（ステップの作りが違う）は null（手続きの詳細画面で見る）。
 * 種類だけでは旧方式と見分けられないため、ウィザードにしかないステップで見分ける（functions/src/procedures/templates.ts）
 */
const WIZARDS: Record<string, { step: string; route: string }> = {
  acquisition: { step: 'invite', route: '/onboarding' },
  loss: { step: 'settlement', route: '/resignation' },
  dependent_change: { step: 'change', route: '/dependents' },
  maternity_leave: { step: 'plan', route: '/leaves' },
  childcare_leave: { step: 'plan', route: '/leaves' },
  monthly_change: { step: 'judge', route: '/revisions' },
  transfer: { step: 'apply', route: '/transfers' },
  employment_change: { step: 'change_approval', route: '/employment-changes' },
  age_event: { step: 'check', route: '/age-events' },
  grade_correction: { step: 'grade_approval', route: '/grade-corrections' },
};

export function wizardRoute(procedureType: string, stepIds: string[]): string | null {
  const w = WIZARDS[procedureType];
  return w && stepIds.includes(w.step) ? w.route : null;
}
