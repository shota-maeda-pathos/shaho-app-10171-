import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { invalidArg, notFound } from '../../utils/errors';
import {
  applyPersonPatch, isRunCorrection, isSubmittedRunFiling, KIND_LABEL, personBlockers, RunSource, runCorrectionBlocker, runCorrectionsOf,
} from './rules';
import { RunCorrectionCreateInput, RunCorrectionUpdateInput } from './schema';

// 算定基礎届・賞与支払届の訂正届・取消届。元の届出と同じ run の届出として作り、承認・提出は今の仕組み
// （santeiFilingUpdate／bonusFilingUpdate の承認、提出の部品）を使う。等級・保険料は自動では直さない。

const runsOf = (source: RunSource) => (source === 'santei' ? 'santeiRuns' : 'bonusRuns');
const entityOf = (source: RunSource) => (source === 'santei' ? 'santeiFiling' : 'bonusFiling');

function requireOperator(auth: AuthContext) {
  if (!auth.roles.some(r => r === 'admin' || r === 'operator')) throw invalidArg('訂正届・取消届を作り・直せるのは管理者・担当者です');
}

/** 提出済みの算定基礎届・賞与支払届から、選んだ人だけの訂正届・取消届の下書きを作る */
export async function createRunCorrection(input: RunCorrectionCreateInput, auth: AuthContext) {
  requireOperator(auth);
  const reason = input.reason.trim();
  if (!reason) throw invalidArg(`${KIND_LABEL[input.kind]}の理由を入れてください`);
  const runRef = db.doc(`companies/${auth.companyId}/${runsOf(input.source)}/${input.parentId}`);
  const originalRef = runRef.collection('filings').doc(input.filingId);
  const employeeIds = [...new Set(input.employeeIds)];
  const id = await db.runTransaction(async tx => {
    const [run, original, siblings] = await Promise.all([
      tx.get(runRef), tx.get(originalRef), tx.get(runRef.collection('filings').where('originalFilingId', '==', input.filingId)),
    ]);
    if (!original.exists) throw notFound('届出');
    const o = original.data()!;
    requireOffice(auth, o.officeId);
    const blocker = runCorrectionBlocker(input.source, o);
    if (blocker) throw invalidArg(blocker);
    const errors = personBlockers({ kind: input.kind, employeeIds, original: o, siblings: siblings.docs.map(d => d.data()) });
    if (errors.length) throw invalidArg(`次の人は載せられません：${errors.join('、')}`);
    const persons = ((o.persons ?? []) as Record<string, any>[]).filter(p => employeeIds.includes(p.employeeId));
    const number = ((run.data()?.filingCount ?? 0) as number) + 1;
    const now = Timestamp.now();
    const ref = runRef.collection('filings').doc();
    tx.set(ref, {
      number, officeId: o.officeId, ...(o.year !== undefined ? { year: o.year } : {}), ...(o.payMonth !== undefined ? { payMonth: o.payMonth } : {}),
      deadline: null,
      filingType: input.kind, originalFilingType: o.filingType, originalFilingId: input.filingId, originalNumber: o.number ?? null,
      status: 'draft', employeeIds: persons.map(p => p.employeeId), header: o.header ?? {}, persons, originalPersons: persons,
      corrections: [], reason,
      requestedBy: null, requestedAt: null, approvedBy: null, approvedAt: null, rejection: null, submission: null,
      createdBy: auth.uid, createdAt: now, updatedAt: now, version: 1,
    });
    tx.set(runRef, { filingCount: number, updatedAt: now }, { merge: true });
    tx.set(db.collection(`companies/${auth.companyId}/auditLogs`).doc(), {
      entity: entityOf(input.source), entityId: ref.id, action: 'create', changes: { [input.kind]: { from: null, to: input.filingId }, persons: { from: null, to: persons.length } },
      note: reason, performedBy: auth.uid, performedAt: now, version: 1,
    });
    return ref.id;
  });
  return { success: true, filingId: id };
}

/** 訂正届の行・理由を直す（下書き（差し戻しを含む）のときだけ）。取り下げは各届出の「取り消す」を使う */
export async function updateRunCorrection(input: RunCorrectionUpdateInput, auth: AuthContext) {
  requireOperator(auth);
  const ref = db.doc(`companies/${auth.companyId}/${runsOf(input.source)}/${input.parentId}/filings/${input.filingId}`);
  const corrections = await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw notFound('届出');
    const f = snap.data()!;
    requireOffice(auth, f.officeId);
    if (!isRunCorrection(f)) throw invalidArg('訂正届・取消届ではありません');
    if (f.version !== input.expectedVersion) throw invalidArg('届出が更新されています。画面を読み込み直してください');
    if (f.status !== 'draft') throw invalidArg('承認を依頼したあとは直せません（差し戻しを受けてから直します）');
    let persons = (f.persons ?? []) as Record<string, any>[];
    if (input.persons && f.filingType === 'correction') {
      const rejected: string[] = [];
      persons = persons.map(p => {
        const patch = input.persons![p.employeeId];
        if (!patch) return p;
        const r = applyPersonPatch(input.source, p, patch);
        rejected.push(...r.rejected.map(k => `${p.被保険者氏名}：${k}`));
        return r.person;
      });
      const unknown = Object.keys(input.persons).filter(id => !persons.some(p => p.employeeId === id));
      if (unknown.length) throw invalidArg(`この届出に載っていない人です：${unknown.join('、')}`);
      if (rejected.length) throw invalidArg(`次の項目は直せません（数字でない値など）：${rejected.join('、')}`);
    }
    const corrections = f.filingType === 'correction' ? runCorrectionsOf(input.source, f.originalPersons ?? [], persons) : [];
    const reason = input.reason !== undefined ? input.reason.trim() : f.reason;
    if (!reason) throw invalidArg('理由を入れてください');
    const now = Timestamp.now();
    tx.update(ref, { persons, corrections, reason, updatedAt: now, version: f.version + 1 });
    tx.set(db.collection(`companies/${auth.companyId}/auditLogs`).doc(), {
      entity: entityOf(input.source), entityId: input.filingId, action: 'update',
      changes: { corrections: { from: (f.corrections ?? []).length, to: corrections.length } },
      performedBy: auth.uid, performedAt: now, version: f.version + 1,
    });
    return corrections;
  });
  return { success: true, corrections };
}

/**
 * 提出の処理のあとに呼ぶ。run の訂正届・取消届を提出し終えたら、元の届出に印を付ける（一度だけ）。
 * 取消届は載せた人を元の届出の cancelledEmployeeIds に、訂正届は届出の番号を correctedByFilingIds に残す
 */
export async function afterRunCorrectionSubmitted(path: string, source: RunSource) {
  const ref = db.doc(path);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const f = snap.data();
    if (!f || !isRunCorrection(f) || f.appliedToOriginal || !isSubmittedRunFiling(source, f)) return;
    const originalRef = ref.parent.doc(f.originalFilingId);
    const original = await tx.get(originalRef);
    const now = Timestamp.now();
    if (original.exists) {
      tx.update(originalRef, f.filingType === 'cancellation'
        ? { cancelledEmployeeIds: FieldValue.arrayUnion(...(f.employeeIds ?? [])), cancelledByFilingIds: FieldValue.arrayUnion(snap.id), updatedAt: now }
        : { correctedByFilingIds: FieldValue.arrayUnion(snap.id), updatedAt: now });
    }
    tx.update(ref, { appliedToOriginal: now });
  });
}
