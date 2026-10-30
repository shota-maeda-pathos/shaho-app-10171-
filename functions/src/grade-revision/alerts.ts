import { db } from '../config';
import { ProcedureDoc, SalaryDoc } from '../types/firestore';
import { addMonths } from '../insurance/calculator';
import { mapConcurrent } from '../utils/parallel';
import { evaluate } from './service';
import { revisionAlertText } from './rules';

export interface RevisionAlert {
  /** 変動月 */
  startMonth: string;
  text: string;
  /** すでに始めた随時改定の手続き（終えたものを含む） */
  procedureId: string | null;
  procedureDone: boolean;
}

/**
 * 随時改定の可能性（カタログ：変動月を1か月目として、3か月目の給与が承認された時点で自動判定する）。
 * 支給月が3か月目にあたる人について、変動月とその前月の固定的賃金を比べ、変わっていれば判定する。
 * 判定は手続きの画面と同じ evaluate を通す
 */
export async function revisionAlerts(companyId: string, officeId: string, payMonth: string, employeeIds: string[]) {
  const base = `companies/${companyId}`;
  const start = addMonths(payMonth, -2);
  const months = [addMonths(start, -1), start, addMonths(start, 1), payMonth];
  const refs = employeeIds.flatMap(id => months.map(m => db.doc(`${base}/employees/${id}/salaries/${m}`)));
  // getAll は一度に読める数に上限があるため分けて読む
  const parts: FirebaseFirestore.DocumentReference[][] = [];
  for (let i = 0; i < refs.length; i += 300) parts.push(refs.slice(i, i + 300));
  const snaps = (await Promise.all(parts.map(p => db.getAll(...p)))).flat();

  const candidates = employeeIds.filter((_, i) => {
    const [prev, s1, s2, s3] = snaps.slice(i * 4, i * 4 + 4).map(s => s.exists ? s.data() as SalaryDoc : null);
    if (!s1 || !s2 || !s3 || !s1.isConfirmed || !s2.isConfirmed || !s3.isConfirmed) return false;
    const before = prev ? prev.totalFixedWage : s1.previousTotalFixedWage ?? null;
    return before !== null && before !== undefined && before !== s1.totalFixedWage;
  });
  const alerts = new Map<string, RevisionAlert>();
  if (!candidates.length) return alerts;

  const [names, procs] = await Promise.all([
    db.getAll(...candidates.map(id => db.doc(`${base}/employees/${id}`))),
    // 等価条件だけにして複合索引に頼らない
    db.collection(`${base}/procedures`).where('procedureType', '==', 'monthly_change').where('officeId', '==', officeId).get(),
  ]);
  const started = new Map<string, ProcedureDoc & { id: string }>();
  for (const d of procs.docs) {
    const p = d.data() as ProcedureDoc;
    if (p.deletedAt || p.status === 'cancelled' || p.gradeRevision?.kind !== 'occasional' || p.gradeRevision.startMonth !== start || !p.employeeId) continue;
    started.set(p.employeeId, { id: d.id, ...p });
  }
  await mapConcurrent(candidates, 10, async (id, i) => {
    const ev = await evaluate(companyId, id, officeId, 'occasional', { startMonth: start, manualDirection: null, previousRemuneration: null, leave: null });
    const j = ev.judgement;
    if (!j || (j.status !== 'eligible' && j.status !== 'review')) return;
    const e = names[i].data() ?? {};
    const p = started.get(id);
    alerts.set(id, {
      startMonth: start,
      text: j.status === 'eligible' ? revisionAlertText(`${e.lastName ?? ''} ${e.firstName ?? ''}`.trim(), j) : `固定的賃金が変わりました（変動月 ${Number(start.slice(5, 7))}月）。随時改定の対象か確かめてください`,
      procedureId: p?.id ?? null, procedureDone: p?.status === 'completed',
    });
  });
  return alerts;
}
