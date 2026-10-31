import type { MonthlyRow } from '../monthly/service';
import type { TodoTone } from './rules';

type Tone = TodoTone | 'done';
type StepKey = 'salary' | 'salaryReview' | 'calculate' | 'premiumReview' | 'publish' | 'collection';
const STEPS: StepKey[] = ['salary', 'salaryReview', 'calculate', 'premiumReview', 'publish', 'collection'];

/**
 * 1人分の各ステップの状態色。画面の stepState（src/app/features/monthly/monthly.types.ts）と同じ判定で、
 * ホームで「どのステップに何人残っているか」を出すために使う。判定を変えるときは両方を直す
 */
export function stepTone(step: StepKey, r: MonthlyRow): Tone | null {
  const s = r.salary;
  const p = r.premium;
  switch (step) {
    case 'salary':
      if (!r.salaryRequired) return null;
      return s ? 'done' : 'action';
    case 'salaryReview':
      if (!s) return null;
      if (s.confirmed) return 'done';
      if (s.pending) return 'waiting';
      return r.rejected?.salary ? 'action' : 'yours';
    case 'calculate':
      if (r.issues.length) return 'action';
      if (!r.premiumDue) return null;
      if (!p) return 'yours';
      // 確定済み・依頼中でも、計算した後に料率・等級が変わっていれば直す（確定済みは訂正）
      return r.stale || r.outdated?.length ? 'action' : 'done';
    case 'premiumReview':
      if (!p) return null;
      if (p.confirmed) return 'done';
      if (p.pending) return 'waiting';
      return r.rejected?.premium || r.warnings.length ? 'action' : 'yours';
    case 'publish':
      if (!s) return null;
      if (s.published) return 'done';
      if (!s.confirmed || (p && !p.confirmed)) return 'waiting';
      return 'yours';
    case 'collection': {
      const c = r.collection;
      if (!p || c.plan === 'none') return null;
      if (!p.confirmed) return 'waiting';
      if (c.status === 'done') return 'done';
      if (c.status === 'over' || c.status === 'partial') return 'action';
      return c.plan === 'payroll' ? 'yours' : 'action';
    }
  }
}

const NEXT: Record<StepKey, string> = {
  salary: '給与を取り込む',
  salaryReview: '給与の確認を依頼する',
  calculate: '保険料を計算する',
  premiumReview: '保険料の確認を依頼する',
  publish: '明細を公開する',
  collection: '徴収を記録する',
};

export interface MonthlyProgressInput {
  rows: MonthlyRow[];
  reviews: { salary: { mine: boolean } | null; premium: { mine: boolean } | null };
  canApprove: boolean;
}

/**
 * 支給月の処理で次にやること。画面の毎月の処理が最初に開くステップと同じ選び方をする：
 * 承認を頼まれていればその確認、なければ自分がやることのある最初のステップ、それもなければ他の人を待っている最初のステップ。
 * 全員が終わっていれば null
 */
export function monthlyProgress({ rows, reviews, canApprove }: MonthlyProgressInput): { next: string; tone: TodoTone; detail: string | null } | null {
  const active = rows.filter(r => !r.hold);
  const approves = (step: StepKey) =>
    canApprove && ((step === 'salaryReview' && !reviews.salary?.mine) || (step === 'premiumReview' && !reviews.premium?.mine));
  const sums = STEPS.map(step => {
    const tones = active.map(r => stepTone(step, r)).filter((t): t is Tone => t !== null);
    const count = (t: Tone) => tones.filter(x => x === t).length;
    return { step, action: count('action'), yours: count('yours'), waiting: count('waiting') };
  });
  const held = rows.length - active.length;
  const heldNote = held ? `保留中 ${held}名` : null;

  const review = sums.find(s => approves(s.step) && s.waiting > 0);
  if (review) {
    const what = review.step === 'salaryReview' ? '給与' : '保険料';
    return { next: `${what}を承認する（${review.waiting}名）`, tone: 'yours', detail: heldNote };
  }
  const todo = sums.find(s => s.action + s.yours > 0);
  if (todo) {
    const detail = [todo.action ? `要対応 ${todo.action}名` : null, heldNote].filter(Boolean).join('／') || null;
    // 残っているのが確定した後に料率・等級が変わった人だけなら、計算ではなく訂正
    const correcting = todo.step === 'calculate' && active.filter(r => stepTone('calculate', r) === 'action' || stepTone('calculate', r) === 'yours').every(r => r.premium?.confirmed && r.outdated?.length);
    return { next: `${correcting ? '保険料を訂正する' : NEXT[todo.step]}（残り${todo.action + todo.yours}名）`, tone: todo.action ? 'action' : 'yours', detail };
  }
  const wait = sums.find(s => s.waiting > 0);
  if (wait) {
    const what = wait.step === 'salaryReview' || (wait.step === 'publish' && sums[1].waiting > 0) ? '給与' : '保険料';
    return { next: `${what}の承認を待っています（${wait.waiting}名）`, tone: 'waiting', detail: heldNote };
  }
  return null;
}
