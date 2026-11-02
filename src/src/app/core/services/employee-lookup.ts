import { Functions, httpsCallable } from '@angular/fire/functions';

interface LookupItem { id: string; employeeNumber: string; lastName: string; firstName: string }

/**
 * 社員番号または氏名から従業員を1人に決める（帳票・試算の入力欄用）。
 * 社員番号が一致する人がいればその人、いなければ検索結果が1人のときだけその人。
 */
export async function lookupEmployeeId(functions: Functions, companyId: string, text: string): Promise<string> {
  const keyword = text.trim();
  if (!keyword) throw new Error('社員番号または氏名を入れてください');
  const { data } = await httpsCallable<object, { items: LookupItem[] }>(functions, 'employeeList')({
    companyId, keyword, includeResigned: true, limit: 20,
  });
  const exact = data.items.find(e => e.employeeNumber === keyword);
  if (exact) return exact.id;
  if (data.items.length === 1) return data.items[0].id;
  if (data.items.length === 0) throw new Error(`「${keyword}」に当てはまる従業員がいません`);
  throw new Error(`「${keyword}」に当てはまる人が${data.items.length}人います。社員番号で入れてください`);
}
