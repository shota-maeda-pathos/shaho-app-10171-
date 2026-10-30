import { lastDayOfMonth } from '../insurance/calculator';

/** 画面の状態色（要対応・あなたの番・他の人の待ち）と同じ */
export type TodoTone = 'action' | 'yours' | 'waiting';

export interface HomeTodo {
  id: string;
  kind: 'onboarding' | 'resignation' | 'dependent' | 'leave' | 'procedure' | 'monthly';
  /** 何の件か（例：前田 翔太さんの入社） */
  title: string;
  /** 次にやること */
  next: string;
  /** 補足（差し戻しの理由、最後の操作など） */
  detail: string | null;
  officeName: string;
  deadline: string | null;
  tone: TodoTone;
  route: string;
  queryParams: Record<string, string>;
  updatedAt: string | null;
}

/** 支給月の給与の支給日。支給日が月末より後なら月末 */
export function payDateOf(payMonth: string, paymentDay: number | undefined) {
  const last = lastDayOfMonth(payMonth);
  if (!paymentDay || paymentDay < 1) return last;
  return paymentDay >= Number(last.slice(8)) ? last : `${payMonth}-${String(paymentDay).padStart(2, '0')}`;
}

const TONE_ORDER: Record<TodoTone, number> = { action: 0, yours: 1, waiting: 2 };

/** 期限の近い順。期限のないものは後ろ。同じ期限なら要対応・あなたの番・待ちの順 */
export function sortTodos(items: HomeTodo[]) {
  return [...items].sort((a, b) =>
    (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999') || TONE_ORDER[a.tone] - TONE_ORDER[b.tone] || a.title.localeCompare(b.title, 'ja'));
}
