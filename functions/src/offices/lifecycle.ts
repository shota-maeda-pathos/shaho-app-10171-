import { db } from '../config';
import { OfficeDoc } from '../types/firestore';
import { invalidArg, notFound } from '../utils/errors';
import { findAllRates } from '../utils/insurance-rate';

/** 東京の今月 YYYY-MM */
const thisMonth = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }).slice(0, 7);

/** 項目だけで分かる設定の不足（料率は officeSetupIssues で調べる） */
export function fieldIssues(o: Pick<OfficeDoc, 'prefectureCode' | 'pensionOfficeName' | 'insurerId' | 'healthInsuranceType'>): string[] {
  const issues: string[] = [];
  if (!o.prefectureCode) issues.push('都道府県');
  if (!String(o.pensionOfficeName ?? '').trim()) issues.push('管轄年金事務所');
  if (o.healthInsuranceType === 'union' && !String(o.insurerId ?? '').trim()) issues.push('保険者番号（組合健保）');
  return issues;
}

/**
 * 配属できない理由（カタログ1章 事業所ライフサイクル：管轄年金事務所・保険料率の設定を終えるまで配属を受け入れない）。
 * 空なら配属できる。廃止した事業所は「廃止済み」
 */
export async function officeSetupIssues(companyId: string, o: OfficeDoc): Promise<string[]> {
  if (o.abolishedOn) return ['廃止済み'];
  const issues = fieldIssues(o);
  if (o.prefectureCode) {
    try {
      const rates = await findAllRates(companyId, thisMonth(), o.prefectureCode, o.insurerId, o.healthInsuranceType);
      if (!rates.health) issues.push('健康保険料率');
      if (!rates.pension) issues.push('厚生年金保険料率');
    } catch (e) {
      issues.push(`料率（${(e as Error).message}）`);
    }
  }
  return issues;
}

/** 従業員を配属する前に確かめる（登録・入社・異動）。設定が足りなければ止める */
export async function assertAssignable(companyId: string, officeId: string): Promise<void> {
  const snap = await db.doc(`companies/${companyId}/offices/${officeId}`).get();
  if (!snap.exists) throw notFound('事業所');
  const o = snap.data() as OfficeDoc;
  const issues = await officeSetupIssues(companyId, o);
  if (issues.includes('廃止済み')) throw invalidArg(`${o.name}は廃止した事業所のため、従業員を配属できません`);
  if (issues.length) throw invalidArg(`${o.name}は設定が終わっていないため、従業員を配属できません（足りない設定：${issues.join('・')}）。設定の「事業所」で入れてください`);
}
