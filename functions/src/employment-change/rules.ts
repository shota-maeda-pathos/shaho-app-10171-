import { addDays } from '../insurance/calculator';

/**
 * 雇用条件の変更で、社会保険の加入がどう変わるか（純粋関数）。
 * - 加入していなかった人が加入する → 資格取得届（取得日は新しい条件の初日）
 * - 加入していた人が加入しなくなる → 資格喪失届（適用除外に該当するに至った日の翌日。健康保険法第36条・厚生年金保険法第18条）
 */
export type ChangeEffect = 'none' | 'acquire' | 'lose';

export function changeEffect(before: { health: boolean; pension: boolean } | null, after: { health: boolean; pension: boolean }): ChangeEffect {
  const wasIn = !!before && (before.health || before.pension);
  const nowIn = after.health || after.pension;
  if (!wasIn && nowIn) return 'acquire';
  if (wasIn && !nowIn) return 'lose';
  return 'none';
}

export const EFFECT_LABEL: Record<ChangeEffect, string> = {
  none: '加入は変わりません（届出なし）',
  acquire: '社会保険に加入します（資格取得届）',
  lose: '社会保険の加入から外れます（資格喪失届）',
};

/** 資格を得る日・失う日 */
export function qualificationDateOf(effect: ChangeEffect, effectiveDate: string): string | null {
  if (effect === 'acquire') return effectiveDate;
  if (effect === 'lose') return addDays(effectiveDate, 1);
  return null;
}

export interface ChangeNotesInput {
  effect: ChangeEffect;
  enrolledAfter: boolean;
  fixedBefore: number;
  fixedAfter: number;
  categoryBefore: string;
  categoryAfter: string;
  contractEndBefore: string | null;
  contractEndAfter: string | null;
}

const CATEGORY_LABEL: Record<string, string> = { general: '一般', partTimer: 'パートタイマー', shortTime: '短時間労働者' };

/** 届出のほかに知らせること */
export function changeNotes(i: ChangeNotesInput): string[] {
  const notes: string[] = [];
  if (i.enrolledAfter && i.effect === 'none' && i.fixedBefore !== i.fixedAfter) {
    notes.push(`固定的賃金が${i.fixedBefore.toLocaleString('ja-JP')}円から${i.fixedAfter.toLocaleString('ja-JP')}円に変わります。変わった給与を3か月払ったら、随時改定の対象か確かめてください`);
  }
  if (i.enrolledAfter && i.categoryBefore !== i.categoryAfter) {
    notes.push(`被保険者の区分が「${CATEGORY_LABEL[i.categoryBefore] ?? i.categoryBefore}」から「${CATEGORY_LABEL[i.categoryAfter] ?? i.categoryAfter}」に変わります（算定基礎届・随時改定の支払基礎日数の基準が変わります）`);
  }
  if (i.contractEndAfter && i.contractEndAfter !== i.contractEndBefore) {
    notes.push(`契約期間の終わりは${i.contractEndAfter}になります（満了が近づくとホームに出ます）`);
  }
  return notes;
}
