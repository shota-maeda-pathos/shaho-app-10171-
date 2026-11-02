import { db } from '../config';
import { hiddenItems } from '../portal/visibility';
import { notify } from './notify';

type GradeLike = { effectiveMonth: string; healthGradeNumber?: number; healthStandardRemuneration?: number; pensionGradeNumber?: number; pensionStandardRemuneration?: number };

const ym = (m: string) => `${m.slice(0, 4)}年${Number(m.slice(5, 7))}月`;
const man = (n?: number) => (typeof n === 'number' ? `${(n / 10000).toLocaleString('ja-JP')}万円` : '');

/**
 * 等級の変化の文面。変わっていなければ null。
 * 標準報酬月額が同じで等級の番号だけが変わったとき（番号の付け直し・データの訂正）は、保険料も変わらないので知らせない
 */
export function gradeChangeText(before: GradeLike, after: GradeLike): string | null {
  if (before.healthGradeNumber === after.healthGradeNumber && before.pensionGradeNumber === after.pensionGradeNumber) return null;
  if (before.healthStandardRemuneration === after.healthStandardRemuneration && before.pensionStandardRemuneration === after.pensionStandardRemuneration) return null;
  return `${ym(after.effectiveMonth)}から、健康保険 ${before.healthGradeNumber}→${after.healthGradeNumber}等級（標準報酬月額 ${man(before.healthStandardRemuneration)}→${man(after.healthStandardRemuneration)}）、`
    + `厚生年金 ${before.pensionGradeNumber}→${after.pensionGradeNumber}等級（${man(before.pensionStandardRemuneration)}→${man(after.pensionStandardRemuneration)}）に変わりました。保険料の変わる額はポータルの「等級が変わりました」で確かめられます。`;
}

/**
 * 等級が変わったことを本人あてのお知らせにする（カタログ5章 等級変更の通知）。
 * 前の等級：同じ適用月の書き換え（訂正）ならその前の内容、新しい適用月ならその前の月に効いていた等級。最初の等級（入社）は知らせない。
 * 公開範囲で「等級変更のお知らせ」を非公開にしている会社では出さない
 */
export async function notifyGradeChange(companyId: string, employeeId: string, before: GradeLike | undefined, after: GradeLike | undefined): Promise<boolean> {
  if (!after) return false;
  let prior = before;
  if (!prior) {
    const snap = await db.collection(`companies/${companyId}/employees/${employeeId}/grades`).where('effectiveMonth', '<', after.effectiveMonth).orderBy('effectiveMonth', 'desc').limit(1).get();
    prior = snap.empty ? undefined : (snap.docs[0].data() as GradeLike);
  }
  if (!prior) return false;
  const text = gradeChangeText(prior, after);
  if (!text) return false;
  if ((await hiddenItems(companyId)).has('gradeChanges')) return false;
  await notify({ companyId, title: '標準報酬月額（等級）が変わりました', body: text, category: 'system', targetType: 'employee', targetId: employeeId, createdBy: 'system' });
  return true;
}

/**
 * 訂正した保険料が承認し直されたら、本人あてに訂正があった旨を知らせる（カタログ6章⑤）。同じ訂正で二度は出さない。
 * 承認の処理から呼ぶ（毎月の処理のまとめての承認でも呼ぶ）
 */
export async function notifyCorrectedPremium(companyId: string, employeeId: string, premiumPath: string): Promise<boolean> {
  const ref = db.doc(premiumPath);
  const d = (await ref.get()).data();
  if (!d || d.isConfirmed !== true || !d.correctionCount || (d.correctionNotifiedCount ?? 0) >= d.correctionCount) return false;
  await ref.update({ correctionNotifiedCount: d.correctionCount });
  if ((await hiddenItems(companyId)).has('premiums')) return false;
  await notify({
    companyId, title: `${ym(d.yearMonth)}分の保険料を訂正しました`, category: 'salary', targetType: 'employee', targetId: employeeId, createdBy: 'system',
    body: `${ym(d.yearMonth)}分の保険料（本人負担）を ${Number(d.totalEmployeeAmount ?? 0).toLocaleString('ja-JP')}円 に訂正しました（${d.correctionReason ?? '訂正'}）。差額の精算は会社からの案内をご確認ください。`,
  });
  return true;
}
