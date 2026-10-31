import { db } from '../config';

/**
 * 本人ポータルの公開範囲（カタログ11章）。管理者が項目ごとに公開・非公開を決める。既定は全部公開。
 * 非公開の項目はサーバーが返さない（画面で隠すだけにしない）
 */
export const PORTAL_ITEMS = {
  address: '住所',
  employment: '雇用区分・所属',
  insuranceNumbers: '被保険者番号・被保険者整理番号',
  grade: '標準報酬月額・等級',
  insuranceTypes: '適用中の保険の種類・資格取得日',
  premiums: '保険料明細',
  gradeChanges: '等級変更のお知らせ',
  filings: '届出の処理状況',
  dependents: '扶養家族',
} as const;

export type PortalItem = keyof typeof PORTAL_ITEMS;

/** 非公開にした項目の一覧 */
export async function hiddenItems(companyId: string): Promise<Set<PortalItem>> {
  const snap = await db.doc(`companies/${companyId}/settings/portal`).get();
  const hidden = snap.data()?.hidden;
  return new Set(Array.isArray(hidden) ? hidden.filter((k): k is PortalItem => k in PORTAL_ITEMS) : []);
}
