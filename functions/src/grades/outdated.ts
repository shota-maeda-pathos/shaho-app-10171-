import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { db } from '../config';

type GradeLike = { effectiveMonth: string; healthGradeNumber?: number; healthStandardRemuneration?: number; pensionGradeNumber?: number; pensionStandardRemuneration?: number };
type PremiumLike = { yearMonth: string; healthGradeNumber?: number; healthStandardRemuneration?: number; pensionGradeNumber?: number; pensionStandardRemuneration?: number };

/** その月に使う等級（適用月がその月以前で一番新しいもの） */
export function gradeForMonth<T extends GradeLike>(grades: T[], yearMonth: string): T | null {
  return grades.filter(g => g.effectiveMonth <= yearMonth).sort((a, b) => b.effectiveMonth.localeCompare(a.effectiveMonth))[0] ?? null;
}

/** 計算した時の等級と、今その月に使う等級が違うか（等級がなくなった場合も違うとみなす） */
export function isGradeOutdated(premium: PremiumLike, grades: GradeLike[]): boolean {
  const g = gradeForMonth(grades, premium.yearMonth);
  if (!g) return true;
  return g.healthGradeNumber !== premium.healthGradeNumber || g.healthStandardRemuneration !== premium.healthStandardRemuneration
    || g.pensionGradeNumber !== premium.pensionGradeNumber || g.pensionStandardRemuneration !== premium.pensionStandardRemuneration;
}

/**
 * 等級が書き込まれたら（承認・定時決定・遡及の訂正・承認の取消など、どの経路でも）、その適用月以降の計算済みの月の保険料に
 * 「計算した後に等級が変わった」の印（gradeOutdated）を付け直す。毎月の処理の画面がこの印で計算し直し・訂正を促す
 */
export async function markGradeOutdated(companyId: string, employeeId: string, fromMonth: string): Promise<number> {
  const emp = `companies/${companyId}/employees/${employeeId}`;
  const [grades, premiums] = await Promise.all([
    db.collection(`${emp}/grades`).get(),
    db.collection(`${emp}/monthlyInsurance`).where('yearMonth', '>=', fromMonth).get(),
  ]);
  const list = grades.docs.map(d => d.data() as GradeLike);
  const batch = db.batch();
  let changed = 0;
  for (const p of premiums.docs) {
    const outdated = isGradeOutdated(p.data() as PremiumLike, list);
    if ((p.data().gradeOutdated === true) === outdated) continue;
    batch.update(p.ref, { gradeOutdated: outdated });
    changed++;
  }
  if (changed) await batch.commit();
  return changed;
}

/** Firestore のトリガーはデータベースと同じ地域に置く */
export const gradeOutdatedMark = onDocumentWritten({ document: 'companies/{companyId}/employees/{employeeId}/grades/{gradeId}', region: 'asia-northeast1' }, async event => {
  const before = event.data?.before.data() as GradeLike | undefined;
  const after = event.data?.after.data() as GradeLike | undefined;
  const months = [before?.effectiveMonth, after?.effectiveMonth, event.params.gradeId].filter((m): m is string => typeof m === 'string' && /^\d{4}-\d{2}$/.test(m));
  if (!months.length) return;
  await markGradeOutdated(event.params.companyId, event.params.employeeId, months.sort()[0]);
});
