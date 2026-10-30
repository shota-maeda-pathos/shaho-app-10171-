import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { invalidArg, notFound } from '../../utils/errors';
import { stateOf } from '../submission/rules';
import { applyPatch, correctionBlocker, correctionsOf, isCorrectionType } from './rules';
import { CorrectionCreateInput, CorrectionUpdateInput } from './schema';

// 訂正届・取消届。元の届出と同じ従業員の届出として作り、承認・提出は今の仕組み（承認申請・提出の部品）を使う。
// 台帳・等級は自動では直さない（届出の画面で、直す場所へ案内する）。

const KIND_LABEL = { correction: '訂正届', cancellation: '取消届' } as const;

async function employeeOf(companyId: string, employeeId: string, auth: AuthContext) {
  const emp = await db.doc(`companies/${companyId}/employees/${employeeId}`).get();
  if (!emp.exists || emp.data()!.deletedAt != null) throw notFound('従業員');
  requireOffice(auth, emp.data()!.officeId);
  return emp;
}

/** 提出済みの届出から、訂正届・取消届の下書きを作る */
export async function createCorrection(input: CorrectionCreateInput, auth: AuthContext) {
  if (!auth.roles.some(r => r === 'admin' || r === 'operator')) throw invalidArg('訂正届・取消届を作れるのは管理者・担当者です');
  await employeeOf(auth.companyId, input.employeeId, auth);
  const filings = db.collection(`companies/${auth.companyId}/employees/${input.employeeId}/filings`);
  const originalRef = filings.doc(input.filingId);
  const reason = input.reason.trim();
  if (!reason) throw invalidArg(`${KIND_LABEL[input.kind]}の理由を入れてください`);
  const id = await db.runTransaction(async tx => {
    const [original, siblings] = await Promise.all([tx.get(originalRef), tx.get(filings.where('originalFilingId', '==', input.filingId))]);
    if (!original.exists) throw notFound('届出');
    const o = original.data()!;
    const blocker = correctionBlocker(o, input.kind);
    if (blocker) throw invalidArg(blocker);
    // 作りかけ（まだ提出していない）同じ種類の届出があれば、それを開いてもらう
    const open = siblings.docs.find(d => d.data().filingType === input.kind && !d.data().appliedToOriginal && !d.data().discardedAt);
    if (open) return open.id;
    const now = Timestamp.now();
    const ref = filings.doc();
    tx.set(ref, {
      filingType: input.kind, originalFilingId: input.filingId, originalFilingType: o.filingType, reason,
      formData: { ...(o.formData ?? {}) }, corrections: [],
      workflowStatus: 'draft', mockStatus: 'notStarted', submissionStatus: 'notSubmitted', effectiveDate: o.effectiveDate ?? null,
      submittedAt: null, resultReceivedAt: null, resultNote: null, version: 1, createdBy: auth.uid, createdAt: now, updatedAt: now,
    });
    tx.set(db.collection(`companies/${auth.companyId}/auditLogs`).doc(), {
      entity: 'filing', entityId: ref.id, action: 'create', changes: { [input.kind]: { from: null, to: input.filingId } },
      note: reason, performedBy: auth.uid, performedAt: now, version: 1,
    });
    return ref.id;
  });
  return { success: true, filingId: id };
}

/** 訂正届の記入内容・理由を直す（下書き・差し戻しのときだけ）。取り下げ（discard）もここで行う */
export async function updateCorrection(input: CorrectionUpdateInput, auth: AuthContext) {
  if (!auth.roles.some(r => r === 'admin' || r === 'operator')) throw invalidArg('訂正届・取消届を直せるのは管理者・担当者です');
  await employeeOf(auth.companyId, input.employeeId, auth);
  const filings = db.collection(`companies/${auth.companyId}/employees/${input.employeeId}/filings`);
  const ref = filings.doc(input.filingId);
  const result = await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw notFound('届出');
    const f = snap.data()!;
    if (!isCorrectionType(f.filingType)) throw invalidArg('訂正届・取消届ではありません');
    if (f.version !== input.expectedVersion) throw invalidArg('届出が更新されています。画面を読み込み直してください');
    if (f.workflowStatus !== 'draft' && f.workflowStatus !== 'rejected') throw invalidArg('承認を依頼したあとは直せません（差し戻しを受けるか、承認を取り消してから直します）');
    if (f.discardedAt) throw invalidArg('取り下げた届出です');
    const original = await tx.get(filings.doc(f.originalFilingId));
    if (!original.exists) throw notFound('元の届出');
    const now = Timestamp.now();
    if (input.action === 'discard') {
      tx.update(ref, { discardedAt: now, workflowStatus: 'cancelled', cancelledAt: now, updatedAt: now, version: f.version + 1 });
      tx.set(db.collection(`companies/${auth.companyId}/auditLogs`).doc(), {
        entity: 'filing', entityId: ref.id, action: 'update', changes: { discarded: { from: null, to: true } },
        performedBy: auth.uid, performedAt: now, version: f.version + 1,
      });
      return { corrections: f.corrections ?? [], rejected: [] as string[] };
    }
    const originalForm = (original.data()!.formData ?? {}) as Record<string, unknown>;
    let formData = (f.formData ?? {}) as Record<string, unknown>;
    let rejected: string[] = [];
    if (f.filingType === 'correction' && input.formData) ({ formData, rejected } = applyPatch(originalForm, formData, input.formData));
    if (rejected.length) throw invalidArg(`次の項目は直せません（一覧の項目、または数字でない値）：${rejected.join('、')}`);
    const corrections = f.filingType === 'correction' ? correctionsOf(originalForm, formData) : [];
    const reason = input.reason !== undefined ? input.reason.trim() : f.reason;
    if (!reason) throw invalidArg('理由を入れてください');
    tx.update(ref, { formData, corrections, reason, updatedAt: now, version: f.version + 1 });
    tx.set(db.collection(`companies/${auth.companyId}/auditLogs`).doc(), {
      entity: 'filing', entityId: ref.id, action: 'update', changes: { corrections: { from: (f.corrections ?? []).length, to: corrections.length } },
      performedBy: auth.uid, performedAt: now, version: f.version + 1,
    });
    return { corrections, rejected };
  });
  return { success: true, corrections: result.corrections };
}

/**
 * 提出の処理のあとに呼ぶ。訂正届・取消届を提出し終えたら、元の届出に印を付ける（一度だけ）。
 * 取消届は元の届出を取り消し済みに、訂正届は元の届出に訂正届の番号を残す
 */
export async function afterCorrectionSubmitted(path: string) {
  const ref = db.doc(path);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const f = snap.data();
    if (!f || !isCorrectionType(f.filingType) || f.appliedToOriginal) return;
    const { mock, paper } = stateOf('employee', f);
    const done = mock?.status === 'completed' || paper?.status === 'submitted' || paper?.status === 'accepted';
    if (!done) return;
    const originalRef = ref.parent.doc(f.originalFilingId);
    const original = await tx.get(originalRef);
    const now = Timestamp.now();
    if (original.exists) {
      tx.update(originalRef, f.filingType === 'cancellation'
        ? { cancelledAt: now, cancelledByFilingId: snap.id, updatedAt: now }
        : { correctedByFilingIds: FieldValue.arrayUnion(snap.id), updatedAt: now });
    }
    tx.update(ref, { appliedToOriginal: now });
  });
}
