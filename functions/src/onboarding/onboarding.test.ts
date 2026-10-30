jest.mock('../config', () => ({ db: {} }));

import { Timestamp } from 'firebase-admin/firestore';
import { ProcedureDoc } from '../types/firestore';
import { buildOnboardingSteps } from '../procedures/templates';
import { acquisitionFilingDeadline, currentWizardStep, evaluateContract } from './service';

const ctx = {
  birthDate: '1995-06-15',
  hireDate: '2026-11-01',
  office: { fullTimeWeeklyHours: 40, fullTimeMonthlyDays: 21 },
  specificApplicableOffice: false,
};
const contract = {
  employmentType: 'regular' as const, weeklyHours: 40, monthlyDays: 21,
  wageType: 'monthly' as const, wageAmount: 280_000, monthlyHours: null,
  allowances: 20_000, inKind: 0, contractType: 'indefinite' as const, contractEndDate: null,
  renewalExpected: false, isStudent: false,
};

describe('入社：加入の判定と資格取得時決定', () => {
  it('正社員は加入し、月給＋固定的手当から等級を決める', () => {
    const ev = evaluateContract(contract, ctx);
    expect(ev.judgement.result).toBe('applicable');
    expect(ev.chosen).toEqual({ health: true, pension: true });
    expect(ev.remuneration).toBe(300_000);
    expect(ev.healthGrade).toEqual({ gradeNumber: 22, standardRemuneration: 300_000 });
    expect(ev.pensionGrade).toEqual({ gradeNumber: 19, standardRemuneration: 300_000 });
    expect(ev.needsReason).toBe(false);
    expect(ev.longTermCare).toBe(false);
  });

  it('時給者は週の時間から月の所定労働時間を出して報酬月額にする', () => {
    const ev = evaluateContract({ ...contract, employmentType: 'partTime', wageType: 'hourly', wageAmount: 1_500, weeklyHours: 32, allowances: 0 }, ctx);
    // 32時間 × 52 ÷ 12 = 138.6時間
    expect(ev.monthlyHours).toBe(138.6);
    expect(ev.remuneration).toBe(207_900);
    expect(ev.judgement.result).toBe('applicable');
  });

  it('3/4未満で特定適用事業所でもなければ加入しない。加入させるなら理由が要る', () => {
    const part = { ...contract, employmentType: 'partTime' as const, weeklyHours: 20, monthlyDays: 12 };
    const ev = evaluateContract(part, ctx);
    expect(ev.judgement.result).toBe('notApplicable');
    expect(ev.chosen).toEqual({ health: false, pension: false });
    expect(ev.needsReason).toBe(false);
    expect(evaluateContract({ ...part, healthInsuranceEnrolled: true, pensionEnrolled: true }, ctx).needsReason).toBe(true);
  });

  it('70歳以上は厚生年金に加入しない（年齢による違いは理由不要）。40〜64歳は介護保険', () => {
    const ev = evaluateContract(contract, { ...ctx, birthDate: '1955-01-10' });
    expect(ev.chosen).toEqual({ health: true, pension: false });
    expect(ev.needsReason).toBe(false);
    expect(ev.ageNotes).toHaveLength(1);
    expect(evaluateContract(contract, { ...ctx, birthDate: '1980-01-10' }).longTermCare).toBe(true);
  });

  it('資格取得届の期限は資格取得日の翌日から数えて5日目', () => {
    expect(acquisitionFilingDeadline('2026-04-01')).toBe('2026-04-06');
    // 5日目の11月3日は文化の日のため、翌日の4日まで延びる
    expect(acquisitionFilingDeadline('2026-10-29')).toBe('2026-11-04');
  });
});

describe('入社：ウィザードの現在のステップ', () => {
  const proc = (patch: Record<string, string>, status: ProcedureDoc['status'] = 'in_progress') => ({
    status,
    steps: buildOnboardingSteps().map(s => ({ ...s, status: (patch[s.id] ?? s.status) as never, completedAt: patch[s.id] === 'completed' ? Timestamp.now() : null })),
  }) as unknown as ProcedureDoc;

  it('本人の入力待ち → 登録 → 雇用条件 → 届出 → 承認 → 提出 → 完了確認の順に進む', () => {
    expect(currentWizardStep(proc({ invite: 'in_progress' }))).toBe('invite');
    expect(currentWizardStep(proc({ invite: 'completed', register: 'available' }))).toBe('register');
    expect(currentWizardStep(proc({ invite: 'completed', register: 'completed', contract: 'available' }))).toBe('contract');
    const filed = { invite: 'completed', register: 'completed', contract: 'completed', filing_create: 'completed' };
    expect(currentWizardStep(proc({ ...filed, approval: 'in_progress' }))).toBe('approval');
    expect(currentWizardStep(proc({ ...filed, approval: 'completed', mock_filing: 'in_progress', paper_submit: 'in_progress' }))).toBe('submit');
    expect(currentWizardStep(proc({ ...filed, approval: 'completed', paper_submit: 'completed', confirm: 'available' }))).toBe('confirm');
    expect(currentWizardStep(proc(filed, 'completed'))).toBe('done');
  });

  it('差し戻されたら届出のステップに戻る。加入しない人は届出を飛ばして完了確認', () => {
    const base = { invite: 'completed', register: 'completed', contract: 'completed' };
    expect(currentWizardStep(proc({ ...base, filing_create: 'returned', approval: 'returned' }))).toBe('filing');
    expect(currentWizardStep(proc({ ...base, filing_create: 'skipped', approval: 'skipped', mock_filing: 'skipped', paper_submit: 'skipped' }))).toBe('confirm');
  });
});
